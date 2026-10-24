"""Yerel pilot için güncel yayını koruyan, sırları çıktıya yazmayan hazırlık."""
import json
import copy
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

root = Path(__file__).resolve().parent.parent
release = root / '.release-candidates/f04-yerel-pilot-20261023'
assert not release.exists(), 'Mevcut paket üzerine yazılmaz'
current = root / '.release-candidates/demirbas-butce-20261023'
selected = root / '.release-candidates/f04-yerel-secili-kaynak-20261023'
candidate = Path(sys.argv[1]).resolve()
assert json.loads((candidate / 'manifest.json').read_text())['durum'] == 'yerel_aday'

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)

def environment(name):
    obj = json.loads(docker('inspect', name))[0]
    assert obj['State'].get('Health', {}).get('Status') == 'healthy', 'Çalışan servis sağlıklı değil veya yeniden oluşturuluyor: ' + name
    if name.endswith('-api-1'):
        assert obj['Config']['Labels']['com.docker.compose.project.config_files'] == str(current / 'compose.json'), 'Yayındaki sürüm hazırlık sırasında değişti'
    return dict(x.split('=', 1) for x in obj['Config']['Env'])

api = environment('tekir-yerel-pilot-20261019-api-1')
web = environment('tekir-yerel-pilot-20261019-web-1')
worker = environment('tekir-yerel-pilot-20261019-worker-1')

def local_addresses(env):
    result = dict(env)
    ports = {5433: ('pg', 5432), 6380: ('redis', 6379), 9002: ('minio', 9000), 1025: ('mailpit', 1025)}
    for key, value in result.items():
        if '://' in value:
            u = urlsplit(value)
            if u.hostname in ('127.0.0.1', 'localhost') and u.port in ports:
                host, port = ports[u.port]
                auth = u.netloc.rsplit('@', 1)[0] + '@' if '@' in u.netloc else ''
                result[key] = urlunsplit((u.scheme, auth + host + ':' + str(port), u.path, u.query, u.fragment))
        elif key.endswith('SMTP_HOST') and value in ('127.0.0.1', 'localhost'):
            result[key] = 'mailpit'
    return result

release.mkdir()
private = release / 'private'
private.mkdir(mode=0o700)
for name, env in [('api', local_addresses(api)), ('web', web), ('worker', local_addresses(worker))]:
    file = private / (name + '.env')
    assert all('\n' not in v and '\r' not in v for v in env.values())
    file.write_text(''.join(k + '=' + v + '\n' for k, v in env.items()))
    file.chmod(0o600)
gate = private / 'gate.env'
gate.write_text('REDIS_URL=' + local_addresses(api)['REDIS_URL'] + '\nTEKIR_GECIS_NONCE=' + secrets.token_hex(8) + '\n')
gate.chmod(0o600)
subprocess.run(['cp', '-a', '--reflink=auto', str(current / 'runtime'), str(release / 'runtime')], check=True)
# Yalnız yeni, henüz yayınlanmamış hedef kopyasının çıktıları değiştirilir.
import shutil
for src, dest in [(candidate / 'api', release / 'runtime/apps/api/dist'), (selected / 'packages/shared/dist', release / 'runtime/packages/shared/dist'), (selected / 'packages/baglanti/dist', release / 'runtime/packages/baglanti/dist')]:
    shutil.rmtree(dest)
    shutil.copytree(src, dest, symlinks=True)
generated = next((selected / 'node_modules/.pnpm').glob('@prisma+client*/node_modules/.prisma/client'))
relative = generated.relative_to(selected)
target = release / 'runtime' / relative
assert target.is_dir()
shutil.rmtree(target)
shutil.copytree(generated, target, symlinks=True)
shutil.copytree(candidate / 'web', release / 'web', symlinks=True)
(release / 'tools').mkdir()
for filename in ['kontrol.cjs', 'gecis.cjs']:
    shutil.copyfile(root / '.release-candidates/f04-isletim-20261023/tools' / filename, release / 'tools' / filename)
for src, filename in [('f04-yerel-pilot-ac.cjs', 'pilot-ac.cjs'), ('f04-yerel-pilot-tarayici.cjs', 'pilot-tarayici.cjs')]:
    shutil.copyfile(root / 'scripts' / src, release / 'tools' / filename)
compose = json.loads((root / '.release-candidates/f04-isletim-20261023/isletim/compose.json').read_text())
compose['name'] = 'tekir-f04-yerel-20261023'
compose['networks']['default']['name'] = 'tekir-f04-yerel-20261023'
compose['services'].pop('dogrulama')
browser = root / '.release-candidates/cekirdek-aday-20261018-3/api-worker-runtime-20261018T105632135Z-e6c489-browsers'
for name, service in compose['services'].items():
    envname = {'yeni-api': 'api', 'yeni-web': 'web', 'yeni-worker': 'worker', 'gecis': 'gate'}[name]
    service['env_file'] = [{'path': str(private / (envname + '.env')), 'format': 'raw'}]
    for volume in service.get('volumes', []):
        volume['source'] = str(browser if volume['target'] == '/browsers' else release / {'/runtime': 'runtime', '/web': 'web', '/tools': 'tools'}[volume['target']])
compose['services']['yeni-web']['working_dir'] = '/web/apps/web'
compose['services']['yeni-web']['command'] = ['server.js']
# İzole kaynakların Next tracing kökü üst monorepo olabilir. Bütün standalone
# ağacını koru; gerçek sunucu girişine static/public dosyalarını yerleştir.
servers = [p for p in (release / 'web').rglob('server.js') if str(p).endswith('/apps/web/server.js')]
assert len(servers) == 1, 'Tek standalone web sunucusu beklenir'
app = servers[0].parent
dist = Path(json.loads((candidate / 'manifest.json').read_text())['webDist']).name
for name in [dist + '/static', 'public']:
    src = release / 'web/apps/web' / name
    dest = app / name
    if src.exists() and src != dest:
        shutil.copytree(src, dest, dirs_exist_ok=True, symlinks=True)
compose['services']['yeni-web']['working_dir'] = '/web/' + str(app.relative_to(release / 'web'))
compose['services']['yeni-worker']['environment']['WORKER_METRICS_PORT'] = '9464'
compose['services']['gecis']['ports'] = ['127.0.0.1:3100:8080']
for new, old in [('yeni-api', 'eski-api'), ('yeni-web', 'eski-web'), ('yeni-worker', 'eski-worker')]:
    service = copy.deepcopy(compose['services'][new])
    service['profiles'] = ['geri-donus']
    for volume in service.get('volumes', []):
        if volume['target'] in ('/runtime', '/web'):
            volume['source'] = str(current / volume['target'][1:])
    if new == 'yeni-web':
        service['network_mode'] = 'service:eski-api'
        service['working_dir'] = '/web/apps/web'
    if 'depends_on' in service:
        service['depends_on'] = {key.replace('yeni-', 'eski-'): value for key, value in service['depends_on'].items()}
    compose['services'][old] = service
(release / 'compose.json').write_text(json.dumps(compose, indent=2) + '\n')
command = '/usr/bin/docker compose -f ' + str(release / 'compose.json')
(release / 'tekirextra-f04-yerel.service').write_text(f'''[Unit]
Description=TekirExtra F04 yerel pilot
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory={release}
ExecStartPre={command} config --quiet
ExecStartPre={command} run --rm --no-deps --entrypoint node gecis /tools/kontrol.cjs hazirla
ExecStart={command} up --detach --wait --wait-timeout 180 yeni-api yeni-web yeni-worker gecis
ExecStartPost={command} exec -T gecis node /tools/kontrol.cjs ac
ExecStop={command} exec -T gecis node /tools/kontrol.cjs kapat
ExecStop={command} stop --timeout 30
ExecStopPost={command} stop --timeout 30
TimeoutStartSec=360
TimeoutStopSec=180
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
''')
(release / 'hazirlik.json').write_text(json.dumps({'durum': 'hazirlandi_yayinlanmadi', 'oncekiCompose': str(current / 'compose.json'), 'aday': str(candidate), 'sozHatirlatma': 'mevcut konteyner korunur', 'migration': 'yalnız üç F04 migration'}, indent=2) + '\n')
print('Yerel paket hazır; canlı servis ve şema değiştirilmedi.')
