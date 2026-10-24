import * as fs from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {files,fingerprints,sha} from './lib/f02-aday-dosyalari.mjs';

// Beklenen büyük dosya haritası onaylı kaynak manifestlerinden gelir; kopyanın kendisinden türetilmez.
export async function manifestHazirla(root,output){
 const old=JSON.parse(await fs.readFile(resolve(root,'.release-candidates/f04-ihtiyac-20261019/runtime-manifest.json'),'utf8'));
 const api=JSON.parse(await fs.readFile(resolve(root,'.release-candidates/f04-ebelge-korumali-20261023/yeni-api-manifest.json'),'utf8'));
 const web=JSON.parse(await fs.readFile(resolve(root,'.release-candidates/f04-servis-gecis-20261022/yeni-web-manifest.json'),'utf8'));
 const browsers=JSON.parse(await fs.readFile(resolve(root,'.release-candidates/cekirdek-aday-20261018-3/api-worker-runtime-20261018T105632135Z-e6c489-browsers.manifest.json'),'utf8'));
 const acceptancePath=resolve(root,'.release-candidates/f04-birlesik-gecis-20261023/servis-gecis-ozeti.json');
 const acceptance=JSON.parse(await fs.readFile(acceptancePath,'utf8'));
 assert.equal(acceptance.durum,'gecti');assert.equal(acceptance.temizlik,true);assert.equal(acceptance.kontroller[0].eskiRuntime,old.dosyaOzeti);assert.equal(acceptance.kontroller[0].yeniApi,api.dosyaOzeti);
 const gen=Object.keys(old.dosyalar).filter(p=>p.endsWith('/.prisma/client/index.js')).map(p=>p.slice(0,-'/index.js'.length));assert.equal(gen.length,1);
 const prefixes={dist:'apps/api/dist','prisma-client':gen[0],shared:'packages/shared/dist',baglanti:'packages/baglanti/dist'};
 const expected=Object.fromEntries(Object.entries(old.dosyalar).filter(([p])=>!Object.values(prefixes).some(prefix=>p===prefix||p.startsWith(prefix+'/'))));
 for(const [path,hash] of Object.entries(api.files)){const slash=path.indexOf('/'),folder=path.slice(0,slash);assert(prefixes[folder]);expected[prefixes[folder]+'/'+path.slice(slash+1)]=hash;}
 const spec={surum:1,aday:{id:'f04-isletim-20261023',apiDosyaOzeti:api.dosyaOzeti,webBuildId:web.webBuildId},dizinler:{runtime:expected,web:web.files,browsers:browsers.files}};
 for(const folder of ['tools','isletim'])spec.dizinler[folder]=await fingerprints(await files(resolve(output,folder),true),resolve(output,folder));
 await fs.writeFile(resolve(output,'surum.json'),JSON.stringify(spec,null,2)+'\n');
 await fs.writeFile(resolve(output,'paket.json'),JSON.stringify({surum:1,durum:'dogrulama_bekleniyor',kaynakApi:api.dosyaOzeti,kaynakWeb:web.dosyaOzeti,birlesikKabulSha256:sha(await fs.readFile(acceptancePath)),paketleyiciSha256:sha(await fs.readFile(resolve(root,'scripts/f04-isletim-paketle.mjs'))),manifestBetikSha256:sha(await fs.readFile(import.meta.filename)),beklenenDosyaAdedi:Object.values(spec.dizinler).reduce((n,rows)=>n+Object.keys(rows).length,0),yayinlandi:false,hostRebootKaniti:false,hedefEnvDosyasiOkundu:false},null,2)+'\n');
 return spec;
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){const root=resolve(import.meta.dirname,'..');const spec=await manifestHazirla(root,resolve(root,'.release-candidates/f04-isletim-20261023'));console.log(JSON.stringify({durum:'dogrulama_bekleniyor',beklenenDosyaAdedi:Object.values(spec.dizinler).reduce((n,x)=>n+Object.keys(x).length,0)}));}
