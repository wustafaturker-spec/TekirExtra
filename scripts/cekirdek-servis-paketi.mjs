import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { adayiDogrula } from './f02-aday-dogrula.mjs';
import { dogrula } from './cekirdek-servis-dogrula.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
assert(process.argv[2], 'Kullanım: node scripts/cekirdek-servis-paketi.mjs <aday>');
const candidate = resolve(process.argv[2]), output = join(candidate, 'isletim');
const read = async name => JSON.parse(await readFile(join(candidate, name), 'utf8'));
const aday = await adayiDogrula(candidate, { kaynak: false });
const acceptance = await read('cekirdek-isletim-kabul-ozeti.json');
assert.equal(acceptance.durum, 'gecti'); assert.equal(acceptance.temizlik, true);
assert.equal(acceptance.aday.dosyaOzeti, aday.dosyaOzeti);
assert.equal(sha(await readFile(join(candidate, acceptance.rapor.file))), acceptance.rapor.sha256);
const pointer = await read('runtime-son-aday.json'), manifest = await read('manifest.json');
assert(/^api-worker-runtime-[a-zA-Z0-9-]+$/.test(pointer.name));
const runtime = await read(pointer.manifest), browsers = await read(pointer.name + '-browsers.manifest.json');
assert.equal(runtime.durum, 'paketlendi'); assert.equal(runtime.aday.dosyaOzeti, aday.dosyaOzeti);
const spec = { surum: 1, aday, dizinler: { api: {}, web: {}, [pointer.name]: runtime.files, [browsers.name]: browsers.files } };
for (const [path, hash] of Object.entries(manifest.dosyalar)) {
  for (const folder of ['api', 'web']) if (path.startsWith(folder + '/')) spec.dizinler[folder][path.slice(folder.length + 1)] = hash;
}
assert(Object.keys(spec.dizinler.api).length && Object.keys(spec.dizinler.web).length);
const verified = await dogrula(candidate, spec);
await mkdir(output);
await copyFile(join(root, 'scripts/cekirdek-servis-dogrula.mjs'), join(output, 'dogrula.mjs'));
await writeFile(join(output, 'surum.json'), JSON.stringify(spec, null, 2) + '\n');
const image = 'sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';
const bind = (source, target) => ({ type: 'bind', source, target, read_only: true, bind: { create_host_path: false } });
const health = (port, path) => ({ test: ['CMD', 'node', '-e', `fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(3000)}).then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>{process.exitCode=1})`], interval: '5s', timeout: '4s', retries: 12, start_period: '20s' });
const base = { image, pull_policy: 'never', init: true, read_only: true, restart: 'on-failure:3', tmpfs: ['/tmp:rw,size=128m'], mem_limit: '512m', logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } }, entrypoint: ['node'] };
const apiBase = { ...base, working_dir: '/runtime', env_file: ['${TEKIR_API_ENV_FILE:?Harici API ortam dosyası gerekli}'], volumes: [bind('../' + pointer.name, '/runtime'), bind('../' + browsers.name, '/browsers')] };
const compose = {
  name: 'tekir-' + manifest.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  services: {
    dogrulama: { image, pull_policy: 'never', profiles: ['kontrol'], network_mode: 'none', read_only: true, mem_limit: '512m', entrypoint: ['node'], command: ['/release/isletim/dogrula.mjs'], volumes: [bind('..', '/release')] },
    api: { ...apiBase, command: ['apps/api/dist/main.js'], environment: { NODE_ENV: 'production', NODE_PATH: '', PORT: '3001', TEKIR_WORKER: '0', PLAYWRIGHT_BROWSERS_PATH: '/browsers' }, ports: ['127.0.0.1:${TEKIR_WEB_PORT:-3100}:3100'], healthcheck: health(3001, '/health/ready') },
    worker: { ...apiBase, command: ['apps/api/dist/main.worker.js'], environment: { NODE_ENV: 'production', NODE_PATH: '', TEKIR_WORKER: '1', PLAYWRIGHT_BROWSERS_PATH: '/browsers' }, depends_on: { api: { condition: 'service_healthy' } }, healthcheck: health(9464, '/health') },
    web: { ...base, command: ['/web/apps/web/server.js'], working_dir: '/web/apps/web', network_mode: 'service:api', environment: { NODE_ENV: 'production', NODE_PATH: '', HOSTNAME: '0.0.0.0', PORT: '3100' }, volumes: [bind('../web', '/web')], depends_on: { api: { condition: 'service_healthy' } }, healthcheck: health(3100, '/giris') },
  },
  networks: { default: { external: true, name: '${TEKIR_NETWORK_NAME:?Önceden hazırlanmış servis ağı gerekli}' } },
};
await writeFile(join(output, 'compose.json'), JSON.stringify(compose, null, 2) + '\n');
await writeFile(join(output, 'tekirextra-aday@.service'), `[Unit]\nDescription=TekirExtra sabit aday %i\nRequires=docker.service\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nWorkingDirectory=/opt/tekirextra/releases/%i/isletim\nExecStartPre=/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f compose.json config --quiet\nExecStartPre=/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f compose.json run --rm --no-deps dogrulama\nExecStart=/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f compose.json up --detach --wait --wait-timeout 180 api worker web\nExecStop=/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f compose.json stop --timeout 30\nExecStopPost=/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f compose.json stop --timeout 30\nTimeoutStartSec=600\nTimeoutStopSec=120\n\n[Install]\nWantedBy=multi-user.target\n`);
await writeFile(join(output, 'compose.env.example'), '# Gizli değer içermez; gerçek API ortam dosyası dışarıda tutulur.\nTEKIR_API_ENV_FILE=/etc/tekirextra/api.env\nTEKIR_NETWORK_NAME=tekirextra-uygulama\nTEKIR_WEB_PORT=3100\n');
const files = {};
for (const name of ['dogrula.mjs', 'surum.json', 'compose.json', 'tekirextra-aday@.service', 'compose.env.example']) files[name] = sha(await readFile(join(output, name)));
await writeFile(join(output, 'paket.json'), JSON.stringify({ surum: 1, durum: 'hazirlandi', aday, kontrol: verified, dosyalar: files, betikSha256: sha(await readFile(fileURLToPath(import.meta.url))), yayinlandi: false, hostRebootKaniti: false }, null, 2) + '\n');
console.log(JSON.stringify({ output, dosyaAdedi: verified.dosyaAdedi, durum: 'hazirlandi' }));
