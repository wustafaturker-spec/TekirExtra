import * as fs from 'node:fs/promises';import {resolve,relative,dirname,isAbsolute,join} from 'node:path';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
import {files,fingerprints,sha} from '../../../scripts/lib/f02-aday-dosyalari.mjs';
const root=resolve(import.meta.dirname,'../../..'),target=resolve(process.env.F04_GECIS_PAKET_ROOT??resolve(root,'.release-candidates/f04-servis-gecis-20261022'));
const apiDist=resolve(process.env.F04_TAM_API_DIST??'/tmp/tekir-f04-servis-gecis-api'),webSource=resolve(process.env.F04_WEB_ROOT??'/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone');
const api=resolve(target,'yeni-api'),web=resolve(target,'yeni-web');
assert(!await fs.access(api).then(()=>true,()=>false)&&!await fs.access(web).then(()=>true,()=>false),'Mevcut paket üzerine yazılmaz; başarısız prova kopyası ayrıca korunmalı');
await fs.access(resolve(apiDist,'main.js'));await fs.access(resolve(webSource,'server.js'));await fs.mkdir(target,{recursive:true});
const hostReq=createRequire(resolve(root,'apps/api/package.json')),gen=resolve(dirname(hostReq.resolve('@prisma/client/package.json')),'../../.prisma/client');
await fs.mkdir(api);await fs.cp(apiDist,resolve(api,'dist'),{recursive:true});await fs.cp(gen,resolve(api,'prisma-client'),{recursive:true,verbatimSymlinks:true});
for(const name of ['shared','baglanti'])await fs.cp(resolve(root,'packages',name,'dist'),resolve(api,name),{recursive:true});
const actual=await fingerprints(await files(api,true),api),sources=await fingerprints([...await files(resolve(root,'apps/api/src')),resolve(root,'apps/api/prisma/schema.prisma')],root);
await fs.writeFile(resolve(target,'yeni-api-manifest.json'),JSON.stringify({surum:1,durum:'paketlendi',kapsam:'Yeni tam API çıktısı + güncel Prisma istemcisi + mevcut workspace dist; 19 Ekim runtime bağımlılık tabanına salt okunur overlay',files:actual,dosyaOzeti:sha(JSON.stringify(actual)),kaynaklar:sources,kaynakOzeti:sha(JSON.stringify(sources)),paketleyiciSha256:sha(await fs.readFile(import.meta.filename))},null,2)+'\n');
await fs.cp(webSource,web,{recursive:true,verbatimSymlinks:true});const changed=[];let procRemoved=false;
const procSelf=resolve(web,'proc/self');if(await fs.lstat(procSelf).then(s=>s.isSymbolicLink(),()=>false)){await fs.unlink(procSelf);procRemoved=true;}
// Tracer hosta mutlak apps/web/node_modules bağı bırakmışsa paket içi next/react bağlarını tamamla.
const webModules=resolve(web,'.'+root,'apps/web/node_modules');if(!await fs.access(webModules).then(()=>true,()=>false)){
 await fs.mkdir(dirname(webModules),{recursive:true});await fs.cp(resolve(root,'.release-candidates/f04-ihtiyac-talep-web-20261019/web/apps/web/node_modules'),webModules,{recursive:true,verbatimSymlinks:true});
}
// Tracer bazı Next dış modüllerini atlamıştı. İzlenen gerçek paketlerin tamamını
// aynı kurulu sürümlerden kopyala; peer bağlantı topolojisini değiştirme.
const completed=[];const store=resolve(web,'.'+root,'node_modules/.pnpm');
async function complete(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(!e.isDirectory())continue;const dest=join(dir,e.name);if(e.name.startsWith('@')){await complete(dest);continue;}const src=resolve('/',relative(web,dest));const a=JSON.parse(await fs.readFile(join(dest,'package.json'),'utf8')),b=JSON.parse(await fs.readFile(join(src,'package.json'),'utf8'));assert.equal(a.name,b.name);assert.equal(a.version,b.version);await fs.cp(src,dest,{recursive:true,verbatimSymlinks:true});completed.push({ad:a.name,surum:a.version});}}
for(const e of await fs.readdir(store,{withFileTypes:true}))if(e.isDirectory()&&e.name!=='node_modules')await complete(join(store,e.name,'node_modules'));
async function walk(dir,base=web){for(const e of await fs.readdir(dir,{withFileTypes:true})){assert(!e.name.startsWith('.env'),'Ortam dosyası pakete alınmaz');const p=join(dir,e.name);if(e.isDirectory())await walk(p,base);else if(e.isSymbolicLink()){const link=await fs.readlink(p);if(isAbsolute(link)){const internal=resolve(base,'.'+link);await fs.access(internal);await fs.unlink(p);await fs.symlink(relative(dirname(p),internal),p);changed.push(relative(base,p));}assert(!relative(base,await fs.realpath(p)).startsWith('..'),'Paket dışı bağlantı: '+p);}}}await walk(web);await walk(api,api);
const webFiles=await fingerprints(await files(web,true),web),builds=Object.keys(webFiles).filter(p=>p.endsWith('/BUILD_ID'));assert.equal(builds.length,1);
await fs.writeFile(resolve(target,'yeni-web-manifest.json'),JSON.stringify({durum:'paketlendi',kaynak:webSource,derlemeDegismedi:true,mutlakBaglantilarGoreliYapildi:changed,procSelfIzlemeArtigiCikarildi:procRemoved,tamRuntimePaketleri:completed,files:webFiles,dosyaOzeti:sha(JSON.stringify(webFiles)),webBuildId:(await fs.readFile(resolve(web,builds[0]),'utf8')).trim(),paketleyiciSha256:sha(await fs.readFile(import.meta.filename))},null,2)+'\n');
console.log('Yeni tam API ve taşınabilir web prova kopyası hazır; hedefe yayın yapılmadı.');
