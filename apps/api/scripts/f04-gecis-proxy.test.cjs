const {test:nodeTest}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {gecisKapisiOlustur}=require('./f04-gecis-proxy.cjs');
const test=(name,fn)=>nodeTest(name,{timeout:10000},fn);
const nonce='0123456789abcdef';
const listen=s=>new Promise((ok,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',()=>ok(s.address().port));});
const close=s=>new Promise(ok=>{s.closeAllConnections();s.close(ok);});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,options={}){
 const received=[],healthSeen=deferred();let healthHold,ready=true,healthCount=0;const healthWaiters=[];
 const upstream=http.createServer(async(q,s)=>{
  if(q.url==='/health/ready'){healthSeen.resolve();healthCount++;for(const w of healthWaiters)if(healthCount>=w.count)w.resolve();if(healthHold)await healthHold.promise;s.writeHead(ready?200:503);s.end('{}');return;}
  if(q.url==='/giris'){s.end('fixture login');return;}
  let body='';for await(const c of q)body+=c;received.push({path:q.url,method:q.method,body,headers:q.headers});s.setHeader('Content-Type','application/json');s.end(JSON.stringify({path:q.url,body}));
 });
 const port=await listen(upstream),backend={hostname:'127.0.0.1',apiPort:port,webPort:port};const gate=gecisKapisiOlustur({nonce,...options,backends:{yeni:backend,eski:backend}}),publicPort=await listen(gate.server),controlPort=await listen(gate.control);
 t.after(async()=>{healthHold?.resolve();gate.serbestBirak();await close(gate.server);await close(gate.control);await close(upstream);});
 const request=(path,options={})=>fetch('http://127.0.0.1:'+publicPort+path,{...options,signal:AbortSignal.timeout(5000)});
 const control=(action,headers={'x-tekir-test-nonce':nonce})=>fetch('http://127.0.0.1:'+controlPort+'/'+action,{method:action==='durum'?'GET':'POST',headers,signal:AbortSignal.timeout(5000)});
 return {received,request,control,healthSeen,waitHealth(count){if(healthCount>=count)return Promise.resolve();const d=deferred();healthWaiters.push({count,resolve:d.resolve});return d.promise;},holdHealth(){healthHold=deferred();return healthHold;},unready(){ready=false;}};
}
const planBody=JSON.stringify({ihtiyacPlaniId:'11111111-1111-4111-8111-111111111111',kalemler:[]});
const post=body=>({method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body});

test('bakım başlangıçta 503/no-store döner; nonce olmadan kontrol değişmez',async t=>{const f=await fixture(t);const r=await f.request('/api/v1/auth/ben');assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('retry-after'),'1');assert.equal((await f.control('eski',{})).status,403);assert.equal(f.received.length,0);});
for(const path of ['/api/v1/satin-alma/talepler','/API/v1/SATIN-ALMA/TALEPLER','/api/v1/satin-alma/talepler/','/Api/V1/Satin-Alma/Talepler/?kaynak=eski-sekme']){
 test('plan bağlı POST eskiye ulaşmaz: '+path,async t=>{const f=await fixture(t);assert.equal((await f.control('eski')).status,200);assert.equal((await f.request(path,post(planBody))).status,409);assert.equal(f.received.length,0);});
}
for(const path of ['/api/v1/stok/ihtiyac-plani/planlar','/API/V1/STOK/IHTIYAC-PLANI/PLANLAR/','/api/v1/stok/ihtiyac-plani/']){
 test('yeni tarihli rota eskiye ulaşmaz: '+path,async t=>{const f=await fixture(t);await f.control('eski');assert.equal((await f.request(path)).status,409);assert.equal(f.received.length,0);});
}
test('normal talep gövdesi/yolu korunur ve anlık önizleme açık kalır',async t=>{const f=await fixture(t);await f.control('eski');const body=JSON.stringify({gerekce:'Normal talep',kalemler:[]});assert.equal((await f.request('/api/v1/satin-alma/talepler/',post(body))).status,200);assert.equal(f.received[0].body,body);assert.equal(f.received[0].path,'/api/v1/satin-alma/talepler/');assert.equal((await f.request('/API/v1/STOK/IHTIYAC-PLANI/ONIZLE/?miktar=1')).status,200);});
test('güncel sürüm plan bağlı POST bilgisini değiştirmeden iletir',async t=>{const f=await fixture(t);await f.control('yeni');const r=await f.request('/api/v1/satin-alma/talepler',post(planBody));assert.equal(r.status,200);assert.equal(r.headers.get('x-tekir-prova-surum'),'yeni');assert.equal(f.received[0].body,planBody);});
test('hazır olmayan hedef bakım kapısını açmaz',async t=>{const f=await fixture(t);f.unready();assert.equal((await f.control('eski')).status,409);assert.equal((await f.request('/api/v1/auth/ben')).status,503);});
test('yeni bakım komutu bekleyen hazırlık sonucunu geçersiz kılar',async t=>{const f=await fixture(t),hold=f.holdHealth();const opening=f.control('eski');await f.healthSeen.promise;assert.equal((await f.control('bakim')).status,200);hold.resolve();assert.equal((await opening).status,409);assert.equal((await f.request('/api/v1/auth/ben')).status,503);});
test('eşzamanlı iki hedef hazırlığından yalnız biri kapıyı açar',async t=>{const f=await fixture(t),hold=f.holdHealth();const a=f.control('eski'),b=f.control('yeni');await f.healthSeen.promise;await f.waitHealth(2);hold.resolve();const codes=await Promise.all([a,b].map(async p=>(await p).status));assert.deepEqual(codes.sort(),[200,409]);});
test('trafik açıkken doğrudan diğer sürüme geçilemez',async t=>{const f=await fixture(t);await f.control('yeni');assert.equal((await f.control('eski')).status,409);assert.equal((await f.request('/api/v1/auth/ben')).headers.get('x-tekir-prova-surum'),'yeni');});
test('kabul edilmiş HTTP tamamlanır; bakımda yeni istek ve erken geçiş engellenir',async t=>{const f=await fixture(t);await f.control('yeni');const held=f.request('/api/v1/auth/ben',{headers:{'x-tekir-test-hold':nonce}});held.catch(()=>{});let seen=false;for(const deadline=Date.now()+5000;Date.now()<deadline;){if((await(await f.control('durum')).json()).held===1){seen=true;break;}await new Promise(r=>setTimeout(r,5));}assert(seen);await f.control('bakim');assert.equal((await f.control('eski')).status,409);assert.equal((await f.request('/api/v1/auth/ben')).status,503);await f.control('serbest');const r=await held;assert.equal(r.status,200);assert.equal(r.headers.get('x-tekir-prova-surum'),'yeni');assert.equal(f.received[0].headers['x-tekir-test-hold'],undefined);assert.equal((await f.control('eski')).status,200);});

test('alan null olsa da plan bağlı POST eskiye ulaşmaz',async t=>{const f=await fixture(t);await f.control('eski');assert.equal((await f.request('/api/v1/satin-alma/talepler',post(JSON.stringify({ihtiyacPlaniId:null})))).status,409);assert.equal(f.received.length,0);});
test('bozuk JSON eski talep API’sine aktarılmaz',async t=>{const f=await fixture(t);await f.control('eski');assert.equal((await f.request('/api/v1/satin-alma/talepler/',post('{bozuk'))).status,400);assert.equal(f.received.length,0);});
test('eski talep kapısı desteklenmeyen içerik biçimini reddeder',async t=>{const f=await fixture(t);await f.control('eski');assert.equal((await f.request('/API/v1/SATIN-ALMA/TALEPLER/',{method:'POST',headers:{'Content-Type':'text/plain'},body:planBody})).status,415);assert.equal(f.received.length,0);});

for(const state of [{paused:false,active:0},{paused:true,active:1},{paused:true,active:'0'},null]){
 test('korumalı eski geçiş kuyruk kanıtını reddeder: '+JSON.stringify(state),async t=>{const f=await fixture(t,{eskiGecisKontrolu:async()=>state});assert.equal((await f.control('eski')).status,409);assert.equal((await f.request('/giris')).status,503);});
}
test('korumalı eski geçiş pause ve aktif sıfırla açılır',async t=>{const f=await fixture(t,{eskiGecisKontrolu:async()=>({paused:true,active:0})});assert.equal((await f.control('eski')).status,200);assert.equal((await f.request('/api/v1/auth/ben')).status,200);});
test('Redis gözlem hatası eski sürümü açmaz, yeni sürüm açılabilir',async t=>{const f=await fixture(t,{eskiGecisKontrolu:async()=>{throw Error('fixture Redis kesik');}});assert.equal((await f.control('eski')).status,409);assert.equal((await f.control('yeni')).status,200);});
test('hazırlık sırasında pause kaybolursa eski geçiş reddedilir',async t=>{let paused=true;const f=await fixture(t,{eskiGecisKontrolu:async()=>({paused,active:0})}),hold=f.holdHealth();const opening=f.control('eski');await f.healthSeen.promise;paused=false;hold.resolve();assert.equal((await opening).status,409);assert.equal((await f.request('/giris')).status,503);});
test('eski trafik açıkken pause kaybı sonraki isteği bakıma alır ve upstreame geçirmez',async t=>{let paused=true;const f=await fixture(t,{eskiGecisKontrolu:async()=>({paused,active:0})});assert.equal((await f.control('eski')).status,200);paused=false;assert.equal((await f.request('/api/v1/auth/ben')).status,503);assert.equal(f.received.length,0);assert.equal((await(await f.control('durum')).json()).mode,'bakim');});
test('yanıtsız Redis gözlemi süre sonunda eski geçişi reddeder',async t=>{const f=await fixture(t,{eskiGecisKontrolu:()=>new Promise(()=>{})});assert.equal((await f.control('eski')).status,409);assert.equal((await f.request('/giris')).status,503);});
