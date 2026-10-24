import * as fs from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {files,fingerprints,sha} from '../../../scripts/lib/f02-aday-dosyalari.mjs';

const root=resolve(import.meta.dirname,'../../..'),target=resolve(root,'.release-candidates/f04-ebelge-korumali-20261023'),api=resolve(target,'yeni-api');
const dist=resolve('/tmp/tekir-f04-korumali-api');
assert(!await fs.access(api).then(()=>true,()=>false),'Mevcut paket üzerine yazılmaz');
assert((await fs.readFile(resolve(dist,'ebelge/ebelge.service.js'),'utf8')).includes('arama desteği sunmuyor'));
await fs.access(resolve(dist,'main.worker.js'));await fs.mkdir(api,{recursive:true});
await fs.cp(dist,resolve(api,'dist'),{recursive:true});
const req=createRequire(resolve(root,'apps/api/package.json')),gen=resolve(dirname(req.resolve('@prisma/client/package.json')),'../../.prisma/client');
await fs.cp(gen,resolve(api,'prisma-client'),{recursive:true,verbatimSymlinks:true});
for(const name of ['shared','baglanti'])await fs.cp(resolve(root,'packages',name,'dist'),resolve(api,name),{recursive:true});
for(const p of await files(api,true)){
  assert(!relative(api,p).split('/').some(x=>x.startsWith('.env')));
  if((await fs.lstat(p)).isSymbolicLink())assert(!relative(api,await fs.realpath(p)).startsWith('..'));
}
const actual=await fingerprints(await files(api,true),api),sources=await fingerprints([...await files(resolve(root,'apps/api/src')),resolve(root,'apps/api/prisma/schema.prisma'),resolve(root,'pnpm-lock.yaml')],root);
await fs.writeFile(resolve(target,'yeni-api-manifest.json'),JSON.stringify({surum:1,durum:'paketlendi',kapsam:'Arama desteği korumalı tam API/worker + Prisma/workspace dist; 19 Ekim bağımlılık tabanına readonly overlay',files:actual,dosyaOzeti:sha(JSON.stringify(actual)),kaynaklar:sources,kaynakOzeti:sha(JSON.stringify(sources)),paketleyiciSha256:sha(await fs.readFile(import.meta.filename))},null,2)+'\n');
console.log('Korumalı tam API/worker sabit prova paketi hazır; yayın yapılmadı.');
