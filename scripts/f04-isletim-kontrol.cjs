const assert=require('node:assert/strict');
function redisAyar(adres='redis://redis:6379'){
 const u=new URL(adres);assert(['redis:','rediss:'].includes(u.protocol),'REDIS_URL protokolü geçersiz');
 const db=u.pathname.length>1?Number(u.pathname.slice(1)):0;assert(Number.isInteger(db)&&db>=0,'Redis DB geçersiz');
 return {host:u.hostname,port:Number(u.port||6379),db,username:decodeURIComponent(u.username)||undefined,password:decodeURIComponent(u.password)||undefined,...(u.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:1};
}
async function kontrol(action,{queue,gate,ready}){
 const drained=async()=>{const deadline=Date.now()+30000;do{const s=await queue.state();assert.equal(s.paused,true,'E-belge kuyruğu pause değil');if(s.active===0)return s;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);throw Error('Aktif e-belge işleri süre içinde bitmedi');};
 if(action==='durum')return {gate:await gate('durum'),queue:await queue.state()};
 if(action==='hazirla'){await queue.pause();return {hazirlik:await drained(),trafikAcilmadi:true};}
 if(action==='kapat'){await gate('bakim');await queue.pause();return {gate:await gate('durum'),queue:await drained()};}
 if(action==='ac'){
  try{
   await drained();await ready();await gate('yeni');
   assert.equal((await gate('durum')).mode,'yeni');await queue.resume();return {gate:await gate('durum'),queue:await queue.state()};
  }catch(e){const errors=[];try{await gate('bakim');}catch{errors.push('Bakım doğrulanamadı');}try{await queue.pause();}catch{errors.push('Pause doğrulanamadı');}if(errors.length)e.message+='; '+errors.join('; ');throw e;}
 }
 throw Error('Komut: durum | hazirla | ac | kapat');
}
module.exports={kontrol,redisAyar};
if(require.main===module){
 const nonce=process.env.TEKIR_GECIS_NONCE;assert(/^[a-f0-9]{16}$/.test(nonce||''),'TEKIR_GECIS_NONCE 16 hex olmalı');
 const req=require('node:module').createRequire('/runtime/apps/api/package.json'),{Queue}=req('bullmq');
 const q=new Queue('tekirextra-ebelge',{connection:redisAyar(process.env.REDIS_URL)});q.on('error',()=>{});
 const get=async(url,options={})=>{const r=await fetch(url,{...options,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('İşletim HTTP kontrolü başarısız: '+r.status);return r;};
 const gate=async action=>(await get('http://127.0.0.1:9090/'+action,{method:action==='durum'?'GET':'POST',headers:{'x-tekir-test-nonce':nonce}})).json();
 const queue={pause:()=>q.pause(),resume:()=>q.resume(),state:async()=>{const c=await q.getBackend().client;const x=await c.eval("return {redis.call('HEXISTS',KEYS[1],'paused'),redis.call('LLEN',KEYS[2])}",2,q.toKey('meta'),q.toKey('active'));return {paused:x[0]===1,active:x[1]};}};
 const ready=async()=>{await get('http://yeni-api:3001/health/ready');await get('http://yeni-api:3100/giris');const r=await(await get('http://yeni-worker:9464/health')).json();assert.equal(r.worker,'ready');};
 kontrol(process.argv[2],{queue,gate,ready}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>q.close());
}
