const {createRequire}=require('node:module');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const url=new URL(process.env.F01_YARIS_DB_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'tekir_app');assert(/^\/f01_yaris_[a-f0-9]{16}$/.test(url.pathname));assert(!['5432','5433'].includes(url.port));
const endpoint=new URL(input.provider);assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.pathname,'/'+process.env.F01_YARIS_NONCE+'/');
const req=createRequire(resolve(__dirname,'../package.json'));
req('reflect-metadata');
const load=p=>req(resolve(process.env.F04_REZERV_API_DIST,p+'.js'));
const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami'),{EbelgeService}=load('ebelge/ebelge.service'),{MetricsService}=load('core/observability/metrics.service');
const db=new PrismaService({datasourceUrl:process.env.F01_YARIS_DB_URL});
async function call(path,body){const r=await fetch(new URL(path,endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Yerel sağlayıcı sorgusu başarısız: '+r.status);return r.json();}
const adapter={saglayici:'nes',belgeGonder:(_cfg,belge)=>call('send',belge)};
if(!input.noLookup)adapter.belgeAra=async(_cfg,id)=>{const r=await call('lookup',{uuid:id});return r.found?r.document:undefined;};
const unused=new Proxy({},{get:(_t,key)=>()=>{throw Error('Kapsam dışı servis: '+String(key));}});
const service=new EbelgeService(db,{adapterCoz:()=>adapter},unused,unused,new MetricsService(),unused,unused,unused);
(async()=>{
  try{
    const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    assert.deepEqual(guard,{db:url.pathname.slice(1),nonce:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
    const result=await baglamlaCalistir({tenantId:input.tenantId,userId:input.userId,rol:'yonetici'},()=>service.gonder(input.invoiceId));
    console.log('F04_EBELGE_SONUC='+JSON.stringify({ok:true,result}));
  }catch(e){console.log('F04_EBELGE_SONUC='+JSON.stringify({ok:false,message:e.message,status:e.getStatus?.()}));}
  finally{await db.$disconnect();}
})().catch(()=>{process.exitCode=1;});
