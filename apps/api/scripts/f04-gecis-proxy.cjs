// CLI yalnız izole prova: backend adresleri sabit, kontrol portu yalnız loopback.
// Fabrika, gerçek HTTP testlerinde rastgele loopback portlarıyla kullanılır.
const http=require('node:http'),assert=require('node:assert/strict');
function gecisKapisiOlustur({nonce,eskiGecisKontrolu,backends={yeni:{hostname:'yeni-api',webPort:3100,apiPort:3001},eski:{hostname:'eski-api',webPort:3100,apiPort:3001}}}){
assert(/^[a-f0-9]{16}$/.test(nonce||''));
let mode='bakim',active=0,revision=0;const holds=new Set();
async function eskiGuvenli(){
 if(!eskiGecisKontrolu)return true;
 let timer;
 try{const state=await Promise.race([eskiGecisKontrolu(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Kuyruk kontrolü zaman aşımı')),2000);})]);return state?.paused===true&&state.active===0;}
 catch{return false;}finally{clearTimeout(timer);}
}
function reply(res,status,message){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(status===503?{'Retry-After':'1'}:{})});res.end(JSON.stringify({mesaj:message}));}
const server=http.createServer(async(req,res)=>{
 const captured=mode;
 if(captured==='bakim'){reply(res,503,'Kontrollü geçiş sürüyor');return;}
 active++;let finished=false;const done=()=>{if(!finished){finished=true;active--;}};res.once('close',done);res.once('finish',done);
 if(captured==='eski'&&!await eskiGuvenli()){revision++;mode='bakim';reply(res,503,'Eski sürüm için e-belge kuyruğu pause ve aktif iş sıfır olmalı');req.resume();return;}
 if(req.headers['x-tekir-test-hold']===nonce)await new Promise(resolve=>{holds.add(resolve);res.once('close',()=>{holds.delete(resolve);resolve();});});
 if(res.destroyed)return;
 const path=new URL(req.url,'http://fixture').pathname.toLowerCase().replace(/\/+$/,''),planRoot='/api/v1/stok/ihtiyac-plani';
 if(captured==='eski'&&(path===planRoot||path.startsWith(planRoot+'/'))&&path!==planRoot+'/onizle'){reply(res,409,'Bu sürüm tarihli plan akışını desteklemiyor');req.resume();return;}
 let buffered;
 if(captured==='eski'&&req.method==='POST'&&path==='/api/v1/satin-alma/talepler'){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')||req.headers['content-encoding']){reply(res,415,'JSON istek gerekli');req.resume();return;}
  const chunks=[];let size=0;
  try{for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){reply(res,413,'İstek çok büyük');return;}chunks.push(chunk);}buffered=Buffer.concat(chunks);const body=JSON.parse(buffered.toString());if(body&&typeof body==='object'&&Object.hasOwn(body,'ihtiyacPlaniId')){reply(res,409,'Plan bağlı istek için güncel sürüm gerekli');return;}}
  catch{reply(res,400,'Geçersiz JSON');return;}
 }
 const headers={...req.headers};delete headers['x-tekir-test-hold'];
 const upstream=http.request({hostname:backends[captured].hostname,port:backends[captured].webPort,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode||502,{...response.headers,'x-tekir-prova-surum':captured});response.pipe(res);});
 upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)reply(res,502,'Sürüm erişilemiyor');else res.destroy();});res.once('close',()=>upstream.destroy());
 if(buffered)upstream.end(buffered);else req.pipe(upstream);
});
const control=http.createServer(async(req,res)=>{
 if(req.headers['x-tekir-test-nonce']!==nonce){reply(res,403,'Test kapsamı gerekli');return;}
 if(req.method==='POST'){
  const action=new URL(req.url,'http://fixture').pathname.slice(1);
  if(action==='serbest'){for(const resolve of holds)resolve();holds.clear();}
  else if(action==='bakim'){revision++;mode='bakim';}
  else if(['yeni','eski'].includes(action)){
   if(mode!=='bakim'||active){reply(res,409,'Önce bakım açılmalı ve devam eden HTTP istekleri bitmeli');return;}
   const expectedRevision=revision;
   try{if(action==='eski'&&!await eskiGuvenli()){reply(res,409,'E-belge kuyruğu pause ve aktif iş sıfır olmadan eski sürüm açılamaz');return;}const target=backends[action];for(const url of [`http://${target.hostname}:${target.apiPort}/health/ready`,`http://${target.hostname}:${target.webPort}/giris`]){const r=await fetch(url,{signal:AbortSignal.timeout(2000)});await r.arrayBuffer();if(!r.ok)throw Error();}if(action==='eski'&&!await eskiGuvenli()){reply(res,409,'Hazırlık sırasında e-belge kuyruk durumu değişti');return;}if(revision!==expectedRevision||mode!=='bakim'||active){reply(res,409,'Geçiş durumu değişti; yeniden kontrol edin');return;}revision++;mode=action;}
   catch{reply(res,409,'Hedef sürüm hazır değil');return;}
  }else{reply(res,400,'Bilinmeyen işlem');return;}
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode,active,held:holds.size}));
});
return {server,control,serbestBirak(){for(const resolve of holds)resolve();holds.clear();}};
}
module.exports={gecisKapisiOlustur};
if(require.main===module){
 let queue;
 if(process.env.TEKIR_EBELGE_GECIS_KAPISI==='1'){
  const req=require('node:module').createRequire('/runtime/apps/api/package.json');const {Queue}=req('bullmq');
  const u=new URL(process.env.REDIS_URL||'redis://redis:6379');assert(['redis:','rediss:'].includes(u.protocol));const db=u.pathname.length>1?Number(u.pathname.slice(1)):0;assert(Number.isInteger(db)&&db>=0);
  queue=new Queue('tekirextra-ebelge',{connection:{host:u.hostname,port:Number(u.port||6379),db,username:decodeURIComponent(u.username)||undefined,password:decodeURIComponent(u.password)||undefined,...(u.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:1}});queue.on('error',()=>{});
 }
 const gate=gecisKapisiOlustur({nonce:process.env.TEKIR_GECIS_NONCE,...(queue?{eskiGecisKontrolu:async()=>{const client=await queue.getBackend().client;const state=await client.eval("return {redis.call('HEXISTS',KEYS[1],'paused'),redis.call('LLEN',KEYS[2])}",2,queue.toKey('meta'),queue.toKey('active'));return {paused:state[0]===1,active:state[1]};}}:{})});
 gate.server.listen(8080,'0.0.0.0');gate.control.listen(9090,'127.0.0.1');process.once('SIGTERM',()=>{gate.serbestBirak();gate.server.close();gate.control.close();void queue?.close();});
}
