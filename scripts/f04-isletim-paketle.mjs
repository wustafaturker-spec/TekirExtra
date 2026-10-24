import * as fs from 'node:fs/promises';
import {resolve,dirname,relative,basename} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {files,fingerprints,sha} from './lib/f02-aday-dosyalari.mjs';
import {manifestHazirla} from './f04-isletim-manifest.mjs';

const root=resolve(import.meta.dirname,'..'),output=resolve(root,'.release-candidates/f04-isletim-20261023');
const old=resolve(root,'.release-candidates/f04-ihtiyac-20261019/runtime'),candidate=resolve(root,'.release-candidates/f04-ebelge-korumali-20261023'),webRoot=resolve(root,'.release-candidates/f04-servis-gecis-20261022');
assert(!await fs.access(output).then(()=>true,()=>false),'Mevcut işletim paketine yazılmaz');
const apiManifest=JSON.parse(await fs.readFile(resolve(candidate,'yeni-api-manifest.json'),'utf8')),webManifest=JSON.parse(await fs.readFile(resolve(webRoot,'yeni-web-manifest.json'),'utf8'));
const acceptance=JSON.parse(await fs.readFile(resolve(root,'.release-candidates/f04-birlesik-gecis-20261023/servis-gecis-ozeti.json'),'utf8'));
assert.equal(acceptance.durum,'gecti');assert.equal(acceptance.temizlik,true);assert.equal(acceptance.birlesikWorkerHttp,true);
assert.equal(acceptance.kontroller[0].yeniApi,apiManifest.dosyaOzeti);
assert.deepEqual(await fingerprints(await files(resolve(candidate,'yeni-api'),true),resolve(candidate,'yeni-api')),apiManifest.files);
assert.deepEqual(await fingerprints(await files(resolve(webRoot,'yeni-web'),true),resolve(webRoot,'yeni-web')),webManifest.files);
assert((await fs.readFile(resolve(candidate,'yeni-api/dist/ebelge/ebelge.service.js'),'utf8')).includes('arama desteği sunmuyor'));
await fs.mkdir(output);const runtime=resolve(output,'runtime');
const copy={recursive:true,verbatimSymlinks:true,filter:path=>!basename(path).startsWith('.env')};
await fs.cp(old,runtime,copy);
const req=createRequire(resolve(old,'apps/api/package.json')),oldGen=resolve(dirname(req.resolve('@prisma/client/package.json')),'../../.prisma/client');assert(!relative(old,oldGen).startsWith('..'));
// Yalnız yeni oluşturulan hedef kopyasındaki eski çıktı değiştirilir.
for(const [source,target] of [[resolve(candidate,'yeni-api/dist'),resolve(runtime,'apps/api/dist')],[resolve(candidate,'yeni-api/prisma-client'),resolve(runtime,relative(old,oldGen))],...['shared','baglanti'].map(n=>[resolve(candidate,'yeni-api',n),resolve(runtime,'packages',n,'dist')])]){
 await fs.rm(target,{recursive:true,force:true});await fs.cp(source,target,copy);
}
await fs.cp(resolve(webRoot,'yeni-web'),resolve(output,'web'),copy);
const browserSource=resolve(root,'.release-candidates/cekirdek-aday-20261018-3/api-worker-runtime-20261018T105632135Z-e6c489-browsers');
const browserManifest=JSON.parse(await fs.readFile(browserSource+'.manifest.json','utf8'));
assert.deepEqual(await fingerprints(await files(browserSource,true),browserSource),browserManifest.files);
await fs.cp(browserSource,resolve(output,'browsers'),copy);
const tools=resolve(output,'tools'),deploy=resolve(output,'isletim');await fs.mkdir(tools);await fs.mkdir(deploy);
await fs.copyFile(resolve(root,'scripts/cekirdek-servis-dogrula.mjs'),resolve(tools,'dosya-dogrula.mjs'));
await fs.copyFile(resolve(root,'scripts/f04-isletim-kontrol.cjs'),resolve(tools,'kontrol.cjs'));
await fs.copyFile(resolve(root,'apps/api/scripts/f04-gecis-proxy.cjs'),resolve(tools,'gecis.cjs'));
await fs.writeFile(resolve(tools,'dogrula.mjs'),`import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {dogrula} from './dosya-dogrula.mjs';const root=resolve(import.meta.dirname,'..');try{const spec=JSON.parse(await readFile(resolve(root,'surum.json'),'utf8'));console.log(JSON.stringify(await dogrula(root,spec)));}catch(e){console.error(e.message);process.exitCode=1;}\n`);
const image='sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';
const bind=(source,target)=>({type:'bind',source,target,read_only:true,bind:{create_host_path:false}});
const health=(port,path)=>({test:['CMD','node','-e',`fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(3000)}).then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>{process.exitCode=1})`],interval:'5s',timeout:'4s',retries:12,start_period:'30s'});
const base={image,pull_policy:'never',init:true,read_only:true,restart:'unless-stopped',stop_grace_period:'30s',tmpfs:['/tmp:rw,size=128m'],mem_limit:'768m',logging:{driver:'json-file',options:{'max-size':'10m','max-file':'3'}},entrypoint:['node']};
const apiBase={...base,working_dir:'/runtime',env_file:['${TEKIR_API_ENV_FILE:?Harici API env dosyası gerekli}'],volumes:[bind('../runtime','/runtime'),bind('../browsers','/browsers')]};
const compose={name:'tekir-f04-isletim',services:{
 'dogrulama':{image,pull_policy:'never',profiles:['kontrol'],network_mode:'none',read_only:true,mem_limit:'512m',entrypoint:['node'],command:['/release/tools/dogrula.mjs'],volumes:[bind('..','/release')]},
 'yeni-api':{...apiBase,command:['apps/api/dist/main.js'],environment:{NODE_ENV:'production',NODE_PATH:'',PORT:'3001',TEKIR_WORKER:'0',PLAYWRIGHT_BROWSERS_PATH:'/browsers'},healthcheck:health(3001,'/health/ready')},
 'yeni-web':{...base,working_dir:'/web',command:['/web/server.js'],network_mode:'service:yeni-api',env_file:['${TEKIR_WEB_ENV_FILE:?Harici web env dosyası gerekli}'],environment:{NODE_ENV:'production',NODE_PATH:'',HOSTNAME:'0.0.0.0',PORT:'3100'},volumes:[bind('../web','/web')],depends_on:{'yeni-api':{condition:'service_healthy'}},healthcheck:health(3100,'/giris')},
 'yeni-worker':{...apiBase,command:['apps/api/dist/main.worker.js'],environment:{NODE_ENV:'production',NODE_PATH:'',TEKIR_WORKER:'1',PLAYWRIGHT_BROWSERS_PATH:'/browsers'},depends_on:{'yeni-api':{condition:'service_healthy'},'yeni-web':{condition:'service_healthy'}},healthcheck:health(9464,'/health')},
 'gecis':{...base,mem_limit:'256m',command:['/tools/gecis.cjs'],env_file:['${TEKIR_GATE_ENV_FILE:?Harici kapı env dosyası gerekli}'],environment:{NODE_ENV:'production',TEKIR_EBELGE_GECIS_KAPISI:'1'},volumes:[bind('../runtime','/runtime'),bind('../tools','/tools')],ports:['127.0.0.1:${TEKIR_HTTP_PORT:-3100}:8080'],depends_on:{'yeni-api':{condition:'service_healthy'},'yeni-web':{condition:'service_healthy'},'yeni-worker':{condition:'service_healthy'}},healthcheck:{test:['CMD','node','-e',"fetch('http://127.0.0.1:9090/durum',{headers:{'x-tekir-test-nonce':process.env.TEKIR_GECIS_NONCE},signal:AbortSignal.timeout(3000)}).then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>{process.exitCode=1})"],interval:'5s',timeout:'4s',retries:12,start_period:'10s'}}
 },networks:{default:{external:true,name:'${TEKIR_NETWORK_NAME:?Mevcut uygulama ağı gerekli}'}}};
await fs.writeFile(resolve(deploy,'compose.json'),JSON.stringify(compose,null,2)+'\n');
const command='/usr/bin/docker compose --env-file /etc/tekirextra/%i.compose.env -f /opt/tekirextra/releases/%i/isletim/compose.json';
await fs.writeFile(resolve(deploy,'tekirextra-f04@.service'),`[Unit]\nDescription=TekirExtra F04 korumalı paket %i\nRequires=docker.service\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nWorkingDirectory=/opt/tekirextra/releases/%i/isletim\nExecStartPre=${command} config --quiet\nExecStartPre=${command} run --rm --no-deps dogrulama\nExecStartPre=${command} run --rm --no-deps --entrypoint node gecis /tools/kontrol.cjs hazirla\nExecStart=${command} up --detach --wait --wait-timeout 180 yeni-api yeni-web yeni-worker gecis\nExecStartPost=${command} exec -T gecis node /tools/kontrol.cjs ac\nExecStop=${command} exec -T gecis node /tools/kontrol.cjs kapat\nExecStop=${command} stop --timeout 30\nExecStopPost=${command} stop --timeout 30\nTimeoutStartSec=900\nTimeoutStopSec=180\n\n[Install]\nWantedBy=multi-user.target\n`);
await fs.writeFile(resolve(deploy,'compose.env.example'),'TEKIR_API_ENV_FILE=/etc/tekirextra/f04.api.env\nTEKIR_WEB_ENV_FILE=/etc/tekirextra/f04.web.env\nTEKIR_GATE_ENV_FILE=/etc/tekirextra/f04.gate.env\nTEKIR_NETWORK_NAME=tekirextra-uygulama\nTEKIR_HTTP_PORT=3100\n');
await fs.writeFile(resolve(deploy,'api.env.example'),'DATABASE_URL=__HEDEF_UYGULAMA_ROLU_URL__\nDATABASE_URL_MIGRATE=__HEDEF_MIGRATION_ROLU_URL__\nREDIS_URL=__HEDEF_REDIS_URL__\nJWT_SECRET=__URETILMIS_GIZLI_DEGER__\nPLATFORM_JWT_SECRET=__AYRI_GIZLI_DEGER__\nOTURUM_ISARETI_SECRET=__WEB_ILE_AYNI_GIZLI_DEGER__\nBAGLANTI_SIFRELEME_ANAHTARI=__MEVCUT_64_HEX_ANAHTAR_KORUNUR__\nS3_ENDPOINT=__HEDEF_S3_ADRESI__\nS3_ERISIM_ANAHTARI=__HEDEF_S3_ERISIM__\nS3_GIZLI_ANAHTAR=__HEDEF_S3_GIZLI__\nS3_KOVA=__HEDEF_KOVA__\nAPP_URL=__HTTPS_ALAN_ADI__\n');
await fs.writeFile(resolve(deploy,'web.env.example'),'OTURUM_ISARETI_SECRET=__API_ILE_AYNI_GIZLI_DEGER__\n');
await fs.writeFile(resolve(deploy,'gate.env.example'),'REDIS_URL=__API_ILE_AYNI_REDIS_URL__\nTEKIR_GECIS_NONCE=__URETILMIS_16_HEX_DEGER__\n');
const spec=await manifestHazirla(root,output);
console.log(JSON.stringify({output,durum:'dogrulama_bekleniyor',dosyaAdedi:Object.values(spec.dizinler).reduce((n,x)=>n+Object.keys(x).length,0),yayinlandi:false}));
