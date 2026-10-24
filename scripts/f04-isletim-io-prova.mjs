import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),bundle=resolve(root,'.release-candidates/f04-isletim-20261023'),nonce=randomBytes(8).toString('hex'),network='tekir-f04-isletim-'+nonce,names=[];
const image='sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';
assert.equal(JSON.parse(await fs.readFile(resolve(bundle,'paket.json'),'utf8')).durum,'hazirlandi');
const report={surum:1,durum:'basladi',gercekHedef:false,gercekErpWorker:false,internalAg:true,gercekPaketGecisKapisi:true,kontroller:[],temizlik:false};
let networkCreated=false;
async function run(cmd,args,allowFail=false){return new Promise((ok,fail)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],timeout:60000});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);p.on('error',fail);p.on('close',code=>code===0||allowFail?ok({code,output:output.trim()}):fail(Error(cmd+' exit '+code+': '+output.slice(-2000))));});}
const docker=args=>run('docker',args);
async function start(role,args){const name='tekir-f04-isletim-'+role+'-'+nonce;await docker(['run','--pull=never','-d','--name',name,'--label','tekirextra.test=f04-isletim',...args]);names.push(name);return name;}
async function check(ad,fn){await fn();report.kontroller.push({ad,durum:'gecti'});console.log(ad+': geçti');}
try{
 await docker(['network','create','--internal',network]);networkCreated=true;
 await start('redis',['--network',network,'--network-alias','redis','--memory=96m','redis:7-alpine','redis-server','--save','','--appendonly','no']);
 const code=`const http=require('node:http');let ready=true,failOpen=false,checks=0;const servers=[];for(const port of [3001,3100,9464,9089]){const server=http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');if(port===9089){if(q.url==='/fixture/unready')ready=false;if(q.url==='/fixture/ready')ready=true;if(q.url==='/fixture/fail-open'){failOpen=true;checks=0;}s.end('{}');return;}if(port===3001)checks++;if(!ready||(failOpen&&port===3001&&checks>=2)){s.writeHead(503);s.end('{}');return;}s.end(JSON.stringify(port===9464?{worker:'ready'}:{ready:true}));});server.listen(port,'0.0.0.0');servers.push(server);}process.once('SIGTERM',()=>{for(const s of servers){s.closeAllConnections();s.close();}});`;
 const fixture=await start('health',['--network',network,'--network-alias','yeni-api','--network-alias','yeni-worker','--memory=96m','--read-only','-e','TEKIR_GECIS_NONCE='+nonce,'--entrypoint','node',image,'-e',code]);
 await start('gecis',['--network','container:'+fixture,'--memory=256m','--read-only','--mount','type=bind,source='+resolve(bundle,'runtime')+',target=/runtime,readonly','--mount','type=bind,source='+resolve(bundle,'tools')+',target=/tools,readonly','-e','TEKIR_GECIS_NONCE='+nonce,'-e','TEKIR_EBELGE_GECIS_KAPISI=1','-e','REDIS_URL=redis://redis:6379','--entrypoint','node',image,'/tools/gecis.cjs']);
 const cli=action=>run('docker',['run','--pull=never','--rm','--network','container:'+fixture,'--memory=256m','--read-only','--mount','type=bind,source='+resolve(bundle,'runtime')+',target=/runtime,readonly','--mount','type=bind,source='+resolve(bundle,'tools')+',target=/tools,readonly','-e','TEKIR_GECIS_NONCE='+nonce,'-e','REDIS_URL=redis://redis:6379','--entrypoint','node',image,'/tools/kontrol.cjs',action],true);
 const state=async()=>{const r=await cli('durum');assert.equal(r.code,0,r.output);return JSON.parse(r.output);};
 const fixtureMode=path=>docker(['exec',fixture,'node','-e',"fetch('http://127.0.0.1:9089/'+process.argv[1]).then(async r=>console.log(await r.text())).catch(()=>{process.exitCode=1})",path]);
 await check('hazirla_gercek_redis_pause_yapar_trafik_bakimda_kalir',async()=>{const r=await cli('hazirla');assert.equal(r.code,0,r.output);const s=await state();assert.equal(s.gate.mode,'bakim');assert.deepEqual(s.queue,{paused:true,active:0});});
 await check('paketlenmis_cli_ready_sonrasi_yeni_trafik_ve_resume_yapar',async()=>{const r=await cli('ac');assert.equal(r.code,0,r.output);const s=await state();assert.equal(s.gate.mode,'yeni');assert.equal(s.queue.paused,false);});
 await check('paketlenmis_cli_kapat_ile_bakim_ve_pause_yapar',async()=>{const r=await cli('kapat');assert.equal(r.code,0,r.output);const s=await state();assert.equal(s.gate.mode,'bakim');assert.equal(s.queue.paused,true);});
 await check('hazir_olmayan_backend_ile_aktivasyon_hata_verir_pause_bakim_korur',async()=>{await fixtureMode('fixture/unready');const r=await cli('ac');assert.equal(r.code,1);const s=await state();assert.equal(s.gate.mode,'bakim');assert.equal(s.queue.paused,true);await fixtureMode('fixture/ready');});
 await check('kapinin_reddettigi_aktivasyon_resume_yapmaz',async()=>{await fixtureMode('fixture/fail-open');const r=await cli('ac');assert.equal(r.code,1);const s=await state();assert.equal(s.gate.mode,'bakim');assert.equal(s.queue.paused,true);});
 report.durum='gecti';
}catch(e){report.durum='basarisiz';report.hata=e.message;throw e;}
finally{
 const errors=[];for(const name of names.reverse())try{await docker(['stop','--time','3',name]);await docker(['rm',name]);}catch(e){errors.push(e.message);}
 if(networkCreated)try{await docker(['network','rm',network]);}catch(e){errors.push(e.message);}
 report.temizlik=errors.length===0;report.temizlikHatalari=errors;if(errors.length)report.durum='basarisiz';
 await fs.writeFile(resolve(bundle,'isletim-io-kabul.json'),JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error('İşletim I/O prova kaynakları temizlenemedi');
}
