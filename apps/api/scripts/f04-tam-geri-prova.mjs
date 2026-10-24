import {createRequire} from 'node:module';
import {resolve,relative,dirname} from 'node:path';
import * as fs from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Yalnız kendi geçici DB'sini kuran f01 runner çağırır. Canlı adres veya serbest paket yolu almaz.
export async function tamPaketiProvaEt({run:runnerRun,sql,container,database,password,nonce,base,evidence,devir=false,aktifDevir=false,kurtarma=false,ebelgeDevir=false,ebelgeAktif=false,korumali=false}){
 assert(!aktifDevir || devir,'Aktif iş provası genel worker devrini gerektirir');
 assert(!kurtarma || aktifDevir,'Kurtarma provası aktif iş devrini gerektirir');
 assert(!ebelgeDevir || (devir&&!kurtarma),'E-belge devri genel worker gerektirir; SIGKILL provasıyla ayrı koşulmalı');
 assert(!ebelgeAktif || ebelgeDevir,'Aktif e-belge provası temel e-belge devrini gerektirir');
 assert(!korumali || (devir&&!aktifDevir&&!kurtarma&&!ebelgeDevir),'Korumalı worker ayrı genel devir modudur');
 const root=resolve(import.meta.dirname,'../../..'),network='tekir-f04-eski-'+nonce,names=[];
 const output=resolve(root,'.release-candidates/f04-ihtiyac-20261019/runtime');
 const webCandidate=resolve(root,'.release-candidates/f04-ihtiyac-talep-web-20261019');
 const browserDir=resolve(root,'.release-candidates/cekirdek-aday-20261018-3/api-worker-runtime-20261018T105632135Z-e6c489-browsers');
 const nodeImage='sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';
 assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));assert(/^[a-f0-9]{16}$/.test(nonce));
 assert(/^127\.0\.0\.1:\d+\/f01_yaris_[a-f0-9]{16}$/.test(base));assert(/^[a-f0-9]{64}$/.test(container));
 const loginPassword=randomBytes(20).toString('hex'),jwt=randomBytes(32).toString('hex'),sessionSecret=randomBytes(32).toString('hex'),connectionKey=randomBytes(32).toString('hex');
 const report={surum:1,baslangic:new Date().toISOString(),durum:'basladi',gercekSirketDegisikligi:false,nodeTabanImaji:nodeImage,kontroller:[],temizlik:false,tamAppModule:true,worker:'main.worker.js; özel ödeme sözü workerı değil',hedefServisGecisi:false,genelWorkerDevir:devir};
 const sha=v=>createHash('sha256').update(v).digest('hex');
 const sanitize=value=>{let s=String(value);for(const v of [password,loginPassword,jwt,sessionSecret,connectionKey,token].filter(Boolean))s=s.replaceAll(v,'[redacted]');return s.replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g,'[connection]');};
 const run=(cmd,args,input,options={})=>runnerRun(cmd,args,{...options,...(input===undefined?{}:{input})});
 const docker=args=>run('docker',args);
 const date=n=>new Date(new Date(Date.now()+n*86400000).toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'})+'T00:00:00Z'),day=n=>date(n).toISOString().slice(0,10);
 let db,token,networkCreated=false,pgAttached=false;
 async function check(ad,fn){const begin=Date.now();report.sonKontrol=ad;const detail=await fn();report.kontroller.push({ad,durum:'gecti',ms:Date.now()-begin,...detail});console.log(ad+': geçti');}
 async function start(role,args){const name='tekir-f04-eski-'+role+'-'+nonce;await docker(['run','--pull=never','-d','--name',name,...args]);names.push(name);return name;}
 async function http(container,path,options={},port=3001){
  const code="const f=require('node:fs'),x=JSON.parse(f.readFileSync(0,'utf8'));fetch(x.url,{...x.options,signal:AbortSignal.timeout(20000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(e=>{console.error(JSON.stringify({name:e.name,message:e.message,cause:e.cause?.code}));process.exitCode=1});";
  const r=JSON.parse(await run('docker',['exec','-i',container,'node','-e',code],JSON.stringify({url:'http://127.0.0.1:'+port+path,options}),{timeout:25000}));return {status:r.status,json:()=>JSON.parse(r.body)};
 }
 const tables=['siparis_giris_tarihleri','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari','ihtiyac_satin_alma_baglari'];
 const fingerprint=()=>sql(database,tables.map(t=>`SELECT '${t}',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM public."${t}" x`).join(' UNION ALL ')+" UNION ALL SELECT 'f04_ayar',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM modul_ayarlari x WHERE modul='stok_ihtiyac_plani' UNION ALL SELECT 'f04_audit',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM audit_log x WHERE islem LIKE 'ihtiyac_%' ORDER BY 1");
 let before;
 try{
  assert.equal(await docker(['inspect','--format','{{.Name}}',container]),'/tekir-f01-yaris-'+nonce);
  assert.equal(await docker(['inspect','--format','{{index .Config.Labels "tekirextra.test"}}',container]),'f01-yaris');
  const {files,fingerprints}=await import(resolve(root,'scripts/lib/f02-aday-dosyalari.mjs'));
  const manifest=JSON.parse(await fs.readFile(resolve(output,'../runtime-manifest.json'),'utf8'));
  const verify=async()=>{
   const actual=await fingerprints(await files(output,true),output);assert.deepEqual(actual,manifest.dosyalar);assert.equal(sha(JSON.stringify(manifest.dosyalar)),manifest.dosyaOzeti);
   for(const p of await files(output,true)){if((await fs.lstat(p)).isSymbolicLink())assert(!relative(output,await fs.realpath(p)).startsWith('..'));}
  };
  const browserManifest=JSON.parse(await fs.readFile(browserDir+'.manifest.json','utf8'));
  const verifyBrowser=async()=>assert.deepEqual(await fingerprints(await files(browserDir,true),browserDir),browserManifest.files);
  const {adayiDogrula}=await import(resolve(root,'scripts/f02-aday-dogrula.mjs'));
  await check('eski_paket_ve_bagimlilik_butunlugu',async()=>{await verify();await verifyBrowser();report.web=await adayiDogrula(webCandidate,{kaynak:false});return {runtimeDosyaOzeti:manifest.dosyaOzeti,dosyaAdedi:Object.keys(manifest.dosyalar).length};});
  before=await fingerprint();assert(!before.includes('ihtiyac_planlari|0|'),'Dolu F04 plan fixture gerekli');
  await docker(['network','create','--internal',network]);networkCreated=true;await docker(['network','connect','--alias','pg',network,container]);pgAttached=true;
  await start('redis',['--network',network,'--network-alias','redis','--memory=96m','redis:7-alpine','redis-server','--save','','--appendonly','no']);
  await start('minio',['--network',network,'--network-alias','minio','--memory=256m','--tmpfs','/data:rw,size=128m','-e','MINIO_ROOT_USER=prova','-e','MINIO_ROOT_PASSWORD='+password,'minio/minio:latest','server','/data']);
  const mount=['--mount','type=bind,source='+output+',target=/runtime,readonly'];
  const req=createRequire(resolve(output,'apps/api/package.json'));req('reflect-metadata');const load=p=>req(resolve(output,'apps/api/dist',p+'.js'));
  const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami');db=new PrismaService({datasourceUrl:'postgresql://tekir_app:'+password+'@'+base+'?connection_limit=4'});
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  const f={tenantId:randomUUID(),userId:randomUUID(),cariId:randomUUID(),faturaId:randomUUID()},loginEmail=f.userId+'@test.invalid',passwordHash=await req('argon2').hash(loginPassword),as=fn=>baglamlaCalistir({...f,rol:'yonetici'},fn),tx=fn=>as(()=>db.tenantIslem(f.tenantId,fn,{timeout:30000}));
  const invoice=(id=f.faturaId)=>({id,tenantId:f.tenantId,cariId:f.cariId,tip:'satis',durum:'kesin',tarih:date(-10),vadeTarihi:date(3),dovizCinsi:'TRY',kur:'1',toplamBrut:'2000',toplamMatrah:'2000',genelToplam:'2000',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamKdv:'0',toplamTevkifat:'0',toplamNetKdv:'0'});
  await tx(async t=>{await t.tenant.create({data:{id:f.tenantId,vkn:f.tenantId,unvan:'İzole yeni runtime provası'}});await t.user.create({data:{id:f.userId,tenantId:f.tenantId,eposta:loginEmail,adSoyad:'Fixture',parolaHash:passwordHash,rol:'yonetici',epostaDogrulandi:true}});await t.cariHesap.create({data:{id:f.cariId,tenantId:f.tenantId,kod:'C',unvan:'Fixture cari',tip:'musteri'}});await t.fatura.create({data:invoice()});await t.modulAyar.create({data:{tenantId:f.tenantId,modul:'tahsilat_operasyonu',ayarlar:{surum:1,mod:'pilot'}}});});await db.authKimlik.create({data:{eposta:loginEmail,userId:f.userId,tenantId:f.tenantId}});
  const stokFixture=await tx(async t=>{const stok=await t.stokKart.create({data:{tenantId:f.tenantId,kod:'F04-ESKI',ad:'Eski API ihtiyaç fixture',tip:'urun',anaBirim:'adet'}}),depo=await t.depo.create({data:{tenantId:f.tenantId,kod:'D1',ad:'Eski API fixture deposu'}});await t.stokDepoBakiye.create({data:{tenantId:f.tenantId,stokId:stok.id,depoId:depo.id,mevcutMiktar:'10',rezerveMiktar:'0',yoldakiMiktar:'0'}});return {stokId:stok.id,depoId:depo.id};});
  const env=['-e','OTURUM_ISARETI_SECRET='+sessionSecret,'-e','NODE_ENV=production','-e','NODE_PATH=','-e','DATABASE_URL=postgresql://tekir_app:'+password+'@pg:5432/'+database,'-e','DATABASE_URL_MIGRATE=postgresql://tekir:'+password+'@pg:5432/'+database,'-e','REDIS_URL=redis://redis:6379','-e','JWT_SECRET='+jwt,'-e','PLATFORM_JWT_SECRET='+randomBytes(32).toString('hex'),'-e','BAGLANTI_SIFRELEME_ANAHTARI='+connectionKey,'-e','S3_ENDPOINT=http://minio:9000','-e','S3_ERISIM_ANAHTARI=prova','-e','S3_GIZLI_ANAHTAR='+password,'-e','S3_KOVA=f02-runtime-'+nonce,'-e','SMTP_HOST=127.0.0.1','-e','SMTP_PORT=9'];
  const args=['--network',network,'--memory=512m','--read-only','--tmpfs','/tmp:rw,size=128m','-w','/runtime',...mount,...env,'--entrypoint','node'];
  const api=await start('api',[...args.slice(0,-2),'-e','TEKIR_WORKER=0',...args.slice(-2),nodeImage,'/runtime/apps/api/dist/main.js']);
  let ready=false;for(let i=0;i<100;i++){try{if((await http(api,'/health')).status===200){ready=true;break;}}catch{}if(await docker(['inspect','--format','{{.State.Running}}',api])!=='true')break;await new Promise(r=>setTimeout(r,400));}
  await check('api_cold_start_ve_tum_bagimliliklar_ready',async()=>{assert(ready,'API başlamadı');const r=await http(api,'/health/ready');assert.equal(r.status,200);const b=r.json();assert.equal(b.durum,'ready');assert.equal(b.bagimliliklar.veritabani,'ok');assert.equal(b.bagimliliklar.redis,'ok');assert.equal(b.bagimliliklar.depo,'ok');return b;});
  await check('gercek_parola_ile_http_giris',async()=>{const r=await http(api,'/api/v1/auth/giris',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eposta:loginEmail,parola:loginPassword})});assert.equal(r.status,201);token=r.json().accessToken;assert(token);});
  const request=(path,body,method='GET')=>http(api,'/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await check('kimlik_cari_ve_fatura_okuma',async()=>{const ben=await request('/auth/ben');assert.equal(ben.status,200);assert.equal(ben.json().tenantId,f.tenantId);for(const [path,id] of [['/cari/'+f.cariId,f.cariId],['/fatura/'+f.faturaId,f.faturaId]]){const r=await request(path);assert.equal(r.status,200);assert.equal(r.json().id,id);}});
  await check('eski_tam_api_anlik_stok_ihtiyaci',async()=>{const q=new URLSearchParams({...stokFixture,miktar:'8',birim:'adet',ihtiyacTarihi:day(7)});const r=await request('/stok/ihtiyac-plani/onizle?'+q);assert.equal(r.status,200);assert.equal(r.json().hesap.eksik,'0.000');assert.equal(r.json().hesap.mevcut,'10.000');assert.equal(r.json().tarihli,undefined);return {anlikEksik:r.json().hesap.eksik,tarihliHesapDegil:true};});
  let followup;
  await check('f02_http_takip_ve_gorusme',async()=>{const r=await request('/cari/tahsilat-takipleri',{cariId:f.cariId,sorumluUserId:f.userId,konu:'Runtime fixture takibi',neden:'itiraz',sonrakiIslemTarihi:day(7),sonrakiIslem:'Gerçek iletişim yok',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,201);followup=r.json();const n=await request('/cari/tahsilat-takipleri/'+followup.id+'/gorusmeler',{beklenenSurum:followup.surum,kanal:'not',gorusmeTarihi:day(0),not:'Yalnız izole runtime görüşmesi',istekAnahtari:randomUUID()},'POST');assert.equal(n.status,201);});
  await check('f02_http_odeme_sozu_ve_kaynak_okuma',async()=>{const r=await request('/cari/odeme-sozleri',{cariId:f.cariId,faturaId:f.faturaId,dovizCinsi:'TRY',tutar:'1000.00',sozTarihi:day(7),aciklama:'İzole runtime ödeme sözü',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,201);const list=await request('/cari/odeme-sozleri?cariId='+f.cariId);assert.equal(list.status,200);const b=list.json();assert.equal(b.sozler.length,1);assert.equal(b.sozler[0].gerceklesme.kalan,'1000.00');});
  await check('f02_http_nakit_cift_sayim_yok',async()=>{const r=await request('/nakit-akisi?ufuk=30');assert.equal(r.status,200);const b=r.json(),rows=b.kalemler.filter(p=>p.kaynakId===f.faturaId);assert.equal(rows.reduce((n,p)=>n+p.dovizTutar,0),2000);assert.equal(rows.find(p=>p.odemeSozu).dovizTutar,1000);});
  await tx(async t=>{const i=await t.fatura.create({data:invoice(randomUUID())});await t.odemeSozu.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:i.id,dovizCinsi:'TRY',tutar:'500',sozTarihi:date(-1),verildigiZaman:date(-4),olusturanUserId:f.userId,aciklama:'Yalnız izole worker fixture',istekAnahtari:randomUUID(),girdiOzeti:'a'.repeat(64)}});});
  const setting=await request('/ayarlar/tahsilat_otomasyonu',{acik:true,sorumluUserId:f.userId,uygulamaIciBildirim:true},'PUT');assert.equal(setting.status,200);
  const worker=await start('worker',[...args,nodeImage,'/runtime/apps/api/dist/main.worker.js']);
  await check('worker_cold_start_ve_geciken_soz_baglama',async()=>{let linked=false;for(let i=0;i<100;i++){const n=await tx(t=>t.tahsilatSozBaglantisi.count());if(n===1){linked=true;break;}if(await docker(['inspect','--format','{{.State.Running}}',worker])!=='true')break;await new Promise(r=>setTimeout(r,400));}assert(linked,'Worker sözü bağlamadı');const h=await http(worker,'/health',{},9464);assert.equal(h.status,200);assert.equal(h.json().worker,'ready');const records=await tx(async t=>({takip:await t.tahsilatTakibi.count(),bag:await t.tahsilatSozBaglantisi.findMany(),bildirim:await t.bildirim.findMany({where:{kaynakTur:'tahsilat_takibi'}})}));assert.equal(records.takip,1);assert.equal(records.bag[0].takipId,followup.id);assert.equal(records.bildirim.length,1);});
  await check('http_bildirim_baglanti_ve_gorusme_korunur_eposta_kapali',async()=>{const r=await request('/bildirimler?limit=100&kapsam=bana');assert.equal(r.status,200);assert(r.json().kayitlar.some(k=>k.bildirim.kaynakTur==='tahsilat_takibi'&&k.bildirim.hedefYol==='/panel/cari/tahsilat?takip='+followup.id));const d=await request('/cari/tahsilat-takipleri/'+followup.id);assert.equal(d.status,200);assert.equal(d.json().gorusmeler.length,1);const deliveries=await tx(t=>t.bildirimTeslimati.findMany({where:{bildirim:{kaynakTur:'tahsilat_takibi'}}}));assert.equal(deliveries.length,1);assert.equal(deliveries[0].epostaDurumu,'kapali');});
  await check('api_worker_yeniden_baslatma_kayit_ve_tekillik',async()=>{
    await docker(['restart','--time','3',api,worker]);
    let ready=false;
    for(let i=0;i<100;i++){try{if((await http(api,'/health/ready')).status===200&&(await http(worker,'/health',{},9464)).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}
    assert(ready,'Servisler yeniden başlamadı');
    const r=await request('/cari/tahsilat-takipleri/'+followup.id);assert.equal(r.status,200);assert.equal(r.json().gorusmeler.length,1);
    const counts=await tx(async t=>({bag:await t.tahsilatSozBaglantisi.count(),bildirim:await t.bildirim.count({where:{kaynakTur:'tahsilat_takibi'}})}));assert.deepEqual(counts,{bag:1,bildirim:1});return counts;
  });
  if(devir){
    const newPackage=resolve(root,korumali?'.release-candidates/f04-ebelge-korumali-20261023/yeni-api':'.release-candidates/f04-servis-gecis-20261022/yeni-api');
    const currentManifest=JSON.parse(await fs.readFile(resolve(newPackage,'../yeni-api-manifest.json'),'utf8'));
    const verifyNew=async()=>{assert.deepEqual(await fingerprints(await files(newPackage,true),newPackage),currentManifest.files);assert.equal(sha(JSON.stringify(currentManifest.files)),currentManifest.dosyaOzeti);};
    await check('guncel_genel_worker_paket_butunlugu',async()=>{await verifyNew();return {dosyaOzeti:currentManifest.dosyaOzeti};});
    async function stopped(w){const state=JSON.parse(await docker(['inspect','--format','{{json .State}}',w]));assert.equal(state.Running,false);assert.equal(state.OOMKilled,false);assert([0,143].includes(state.ExitCode),'SIGTERM kapanışı başarısız: '+state.ExitCode);return {exitCode:state.ExitCode};}
    async function readyWorker(w){for(let i=0;i<100;i++){try{if((await http(w,'/health',{},9464)).status===200)return;}catch{}if(await docker(['inspect','--format','{{.State.Running}}',w])!=='true')break;await new Promise(r=>setTimeout(r,300));}throw Error('Genel worker hazır değil');}
    // Üretici yalnız prova API konteynerinden, onun internal Redis bağlantısını kullanır.
    async function queue(action,id){
      const code="const {Queue}=require('bullmq');const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));const q=new Queue('tekirextra-personel',{connection:{host:'redis',port:6379,maxRetriesPerRequest:null}});(async()=>{try{if(x.action==='add')await q.add('bordro-tahakkuk',x.data,{jobId:x.id,attempts:1,removeOnComplete:false,removeOnFail:false});const j=await q.getJob(x.id);console.log(JSON.stringify({id:j.id,state:await j.getState(),attempts:j.attemptsMade,attemptsStarted:j.attemptsStarted,stalledCounter:j.stalledCounter,lockTtl:await (await q.getBackend().client).pttl(q.toKey(j.id)+':lock'),result:j.returnvalue,failedReason:j.failedReason}));}finally{await q.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});";
      return JSON.parse(await run('docker',['exec','-i','-w','/runtime/apps/api',api,'node','-e',code],JSON.stringify({action,id,data:{tenantId:f.tenantId,userId:f.userId,rol:'yonetici',donemYil:2026,donemAy:10}})));
    }
    const ids=['once','yeni','geri'].map(x=>'f04-'+nonce+'-'+x);
    async function complete(id){let r;for(let i=0;i<100;i++){r=await queue('read',id);if(r.state==='completed')break;assert.notEqual(r.state,'failed',r.failedReason);await new Promise(r=>setTimeout(r,200));}assert.equal(r.state,'completed');assert.equal(r.attempts,1);assert.deepEqual(r.result,{olusturulanSayi:0,toplamAktifPersonel:0,mevcutSayi:0,hatalar:[]});return r;}
    await check('eski_genel_worker_gercek_bullmq_isi',async()=>{await queue('add',ids[0]);return complete(ids[0]);});
    await check('eski_worker_durur_bekleyen_is_kuyrukta_kalir',async()=>{await docker(['stop','--time','15',worker]);const state=await stopped(worker);assert.equal((await queue('add',ids[1])).state,'waiting');return state;});
    const oldGen=resolve(dirname(req.resolve('@prisma/client/package.json')),'../../.prisma/client');assert(!relative(output,oldGen).startsWith('..'));
    const overlay=['--mount','type=bind,source='+resolve(newPackage,'dist')+',target=/runtime/apps/api/dist,readonly','--mount','type=bind,source='+resolve(newPackage,'prisma-client')+',target=/runtime/'+relative(output,oldGen)+',readonly'];
    for(const name of ['shared','baglanti'])overlay.push('--mount','type=bind,source='+resolve(newPackage,name)+',target=/runtime/packages/'+name+'/dist,readonly');
    const current=await start('worker-yeni',[...args.slice(0,-2),...overlay,...args.slice(-2),nodeImage,'/runtime/apps/api/dist/main.worker.js']);
    await check('guncel_worker_bekleyen_isi_devralir',async()=>{await readyWorker(current);await stopped(worker);return complete(ids[1]);});
    await check('guncel_worker_restart_tamamlanan_isleri_tekrarlamaz',async()=>{await docker(['restart','--time','15',current]);await readyWorker(current);await stopped(worker);for(const id of ids.slice(0,2))await complete(id);const counts=await tx(async t=>({bag:await t.tahsilatSozBaglantisi.count(),bildirim:await t.bildirim.count({where:{kaynakTur:'tahsilat_takibi'}})}));assert.deepEqual(counts,{bag:1,bildirim:1});return counts;});
    await check('guncel_worker_durur_geri_donus_isi_bekler',async()=>{await docker(['stop','--time','15',current]);const state=await stopped(current);assert.equal((await queue('add',ids[2])).state,'waiting');return state;});
    await check('eski_worker_geri_donuste_isi_devralir',async()=>{await docker(['start',worker]);await readyWorker(worker);await stopped(current);for(const id of ids)await complete(id);return {isAdedi:3,herIsDeneme:1,bosKadro:true};});
    if(aktifDevir){
      const {aktifIsiProvaEt}=await import('./f04-aktif-worker-prova.mjs');
      report.aktifIs=await aktifIsiProvaEt({db,tx,f,sql,database,nonce,docker,queue,worker,current,stopped,readyWorker,check});
    }
    if(kurtarma){
      const {kesilenIsiKurtar}=await import('./f04-worker-kurtarma-prova.mjs');
      report.isKurtarma=await kesilenIsiKurtar({db,tx,f,sql,database,nonce,docker,queue,worker,current,readyWorker,check});
    }
    if(ebelgeDevir){
      const {ebelgeDevriniProvaEt}=await import('./f04-ebelge-devir-prova.mjs');
      report.ebelgeDevir=await ebelgeDevriniProvaEt({db,tx,f,nonce,database,sql,docker,run,api,worker,current,stopped,readyWorker,check,aktifKesinti:ebelgeAktif});
    }
    if(korumali){
      const {korumaliWorkeriProvaEt}=await import('./f04-korumali-worker-prova.mjs');
      report.korumaliWorker=await korumaliWorkeriProvaEt({db,database,nonce,docker,run,api,worker,current,stopped,readyWorker,check,start,network,nodeImage,connectionKey,personelQueue:queue});
    }
    await verifyNew();
  }
  await check('salt_okunur_kapatma_ve_403_http_yazma_engeli',async()=>{const s=await request('/ayarlar/tahsilat_operasyonu',{surum:1,mod:'salt_okunur'},'PUT');assert.equal(s.status,200);const r=await request('/cari/odeme-sozleri',{cariId:f.cariId,faturaId:f.faturaId,dovizCinsi:'TRY',tutar:'1.00',sozTarihi:day(7),aciklama:'İzole engel denemesi',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,403);});

  await check('eski_standalone_web_gercek_form_girisi',async()=>{
    await start('web',['--network','container:'+api,'--memory=512m','--read-only','--tmpfs','/tmp:rw,size=128m','--mount','type=bind,source='+resolve(webCandidate,'web')+',target=/web,readonly','-e','NODE_ENV=production','-e','PORT=3100','-e','HOSTNAME=127.0.0.1','-e','OTURUM_ISARETI_SECRET='+sessionSecret,'--entrypoint','node',nodeImage,'/web/apps/web/server.js']);
    let ready=false;for(let i=0;i<100;i++){try{if((await http(api,'/giris',{},3100)).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert(ready,'Eski web başlamadı');
    // Tahsilat bu noktada salt okunur: yeni iş yazmadan gerçek giriş/okuma sınanır.
    const result=JSON.parse(await run('docker',['run','--pull=never','--rm','-i','--network','container:'+api,'--memory=768m','--read-only','--tmpfs','/tmp:rw,size=256m',...mount,'--mount','type=bind,source='+browserDir+',target=/browsers,readonly','--mount','type=bind,source='+resolve(evidence)+',target=/proof','--mount','type=bind,source='+resolve(root,'apps/api/scripts/f04-eski-paket-tarayici.cjs')+',target=/test.cjs,readonly','-e','PLAYWRIGHT_BROWSERS_PATH=/browsers','--entrypoint','node',nodeImage,'/test.cjs'],JSON.stringify({email:loginEmail,password:loginPassword,followup:followup.id,cari:f.cariId,mode:'salt_okunur',mobile:false}),{timeout:180000}));
    return {gercekFormGirisi:result.gercekFormGirisi,apiMock:result.apiMock,pageErrors:result.pageErrors,webBuildId:report.web.webBuildId};
  });
  await check('yeni_f04_rotalari_eski_tam_api_uzerinde_yok',async()=>{
    const durumlar={};for(const path of ['/stok/ihtiyac-plani/planlar','/stok/ihtiyac-plani/tarihli-onizle','/ayarlar/stok_ihtiyac_plani']){const r=await request(path);assert.equal(r.status,404,path);durumlar[path]=r.status;}return {durumlar,eskiKodYeniModuUygulamaz:true};
  });

  await check('f04_plan_bag_ayar_audit_korundu',async()=>{assert.equal(await fingerprint(),before);return {tabloAdedi:5,ayarVeAuditDahil:true,kayitOzeti:sha(before)};});
  await verify();await verifyBrowser();await adayiDogrula(webCandidate,{kaynak:false});report.durum='gecti';report.testAdedi=report.kontroller.length;
 }catch(e){report.durum='basarisiz';report.hata=sanitize(e.stack||e);throw e;}
 finally{
  report.logs={};for(const name of names)if(name.includes('-api-')||name.includes('-worker-')||name.includes('-web-'))report.logs[name]=sanitize(await docker(['logs','--tail','10',name]).catch(e=>e.message));
  await db?.$disconnect();const errors=[];for(const name of [...names].reverse())try{await docker(['stop','--time','3',name]);await docker(['rm',name]);}catch(e){errors.push(sanitize(e.message));}
  if(pgAttached)try{await docker(['network','disconnect',network,container]);}catch(e){errors.push(sanitize(e.message));}
  if(networkCreated)try{await docker(['network','rm',network]);}catch(e){errors.push(sanitize(e.message));}
  report.temizlik=errors.length===0;report.temizlikHatalari=errors;report.bitis=new Date().toISOString();report.betikSha256=sha(await fs.readFile(import.meta.filename));
  if(!report.temizlik)report.durum='basarisiz';await fs.writeFile(resolve(evidence,'tam-paket-geri-donus.json'),JSON.stringify(report,null,2)+'\n');
  if(!report.temizlik)throw Error('Eski paket prova kaynakları temizlenemedi');
 }
 return report;
}
