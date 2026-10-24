import {createRequire} from 'node:module';
import {resolve,relative,dirname} from 'node:path';
import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Geçici DB'yi kuran runner dışında bağlantı veya paket yolu kabul edilmez.
export async function ozelWorkeriProvaEt({run,sql,container,database,password,nonce,base,evidence,devir=false}){
 const root=resolve(import.meta.dirname,'../../..'),output=resolve(root,'.release-candidates/soz-eposta-20261019/runtime');
 const network='tekir-f04-soz-'+nonce,names=[],nodeImage='sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';
 assert(/^[a-f0-9]{16}$/.test(nonce));assert(/^[a-f0-9]{64}$/.test(container));assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));assert(/^127\.0\.0\.1:\d+\//.test(base)&&base.endsWith('/'+database));
 const report={surum:1,baslangic:new Date().toISOString(),durum:'basladi',gercekSirketDegisikligi:false,gercekAliciyaGonderim:false,internalAg:true,workerDevir:devir,nodeTabanImaji:nodeImage,kontroller:[],temizlik:false};
 const sha=v=>createHash('sha256').update(v).digest('hex'),sanitize=e=>String(e).replaceAll(password,'[redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[connection]');
 const docker=args=>run('docker',args);let db,networkCreated=false,pgAttached=false;
 async function check(ad,fn){const start=Date.now(),detail=await fn();report.kontroller.push({ad,durum:'gecti',ms:Date.now()-start,...detail});console.log(ad+': geçti');}
 async function start(role,args){const name='tekir-f04-soz-'+role+'-'+nonce;await docker(['run','--pull=never','-d','--name',name,...args]);names.push(name);return name;}
 async function get(name,port,path){return run('docker',['exec',name,'node','-e',"fetch('http://127.0.0.1:'+process.argv[1]+process.argv[2],{signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok)process.exitCode=1;console.log(await r.text())}).catch(()=>{process.exitCode=1})",String(port),path],{timeout:10000});}
 async function ready(name,port){for(let i=0;i<100;i++){try{await get(name,port,'/health');return;}catch{}if(await docker(['inspect','--format','{{.State.Running}}',name])!=='true')break;await new Promise(r=>setTimeout(r,300));}throw Error('Test servisi hazır değil: '+name);}
 const tables=['siparis_giris_tarihleri','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari','ihtiyac_satin_alma_baglari'];
 const fingerprint=()=>sql(database,tables.map(t=>`SELECT '${t}',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM public."${t}" x`).join(' UNION ALL ')+" UNION ALL SELECT 'f04_ayar',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM modul_ayarlari x WHERE modul='stok_ihtiyac_plani' UNION ALL SELECT 'f04_audit',count(*)::text,md5(COALESCE(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) FROM audit_log x WHERE islem LIKE 'ihtiyac_%' ORDER BY 1");
 try{
  assert.equal(await docker(['inspect','--format','{{.Name}}',container]),'/tekir-f01-yaris-'+nonce);
  assert.equal(await docker(['inspect','--format','{{index .Config.Labels "tekirextra.test"}}',container]),'f01-yaris');
  const {files,fingerprints}=await import(resolve(root,'scripts/lib/f02-aday-dosyalari.mjs'));
  const manifest=JSON.parse(await fs.readFile(resolve(output,'../paketleme.json'),'utf8'));assert.equal(manifest.durum,'paketlendi');
  const verify=async()=>{const paths=await files(output,true),actual=await fingerprints(paths,output);assert.deepEqual(actual,manifest.dosyalar);assert.equal(sha(JSON.stringify(manifest.dosyalar)),manifest.dosyaOzeti);for(const p of paths)if((await fs.lstat(p)).isSymbolicLink())assert(!relative(output,await fs.realpath(p)).startsWith('..'));};
  await check('ozel_worker_eski_paket_butunlugu',async()=>{await verify();return {dosyaOzeti:manifest.dosyaOzeti,giris:'apps/api/dist/main.odeme-sozu-worker.js'};});
  const newPackage=resolve(root,'.release-candidates/f04-servis-gecis-20261022/yeni-api');
  let verifyNew;
  if(devir){
   const m=JSON.parse(await fs.readFile(resolve(newPackage,'../yeni-api-manifest.json'),'utf8'));
   verifyNew=async()=>{assert.deepEqual(await fingerprints(await files(newPackage,true),newPackage),m.files);};
   await check('guncel_worker_paket_butunlugu',async()=>{await verifyNew();return {dosyaOzeti:m.dosyaOzeti,giris:'dist/main.odeme-sozu-worker.js'};});
  }
  const before=await fingerprint();assert(!before.includes('ihtiyac_planlari|0|'),'Dolu F04 fixture gerekli');
  const req=createRequire(resolve(output,'apps/api/package.json'));req('reflect-metadata');
  const {PrismaService}=req(resolve(output,'apps/api/dist/core/prisma.service.js')),{baglamlaCalistir}=req(resolve(output,'apps/api/dist/core/istek-baglami.js'));
  db=new PrismaService({datasourceUrl:'postgresql://tekir_app:'+password+'@'+base+'?connection_limit=4'});
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  const [clock]=await db.$queryRawUnsafe('SELECT clock_timestamp() AS zaman');const today=clock.zaman.toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}),hour=Number(clock.zaman.toLocaleTimeString('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',hour12:false}));
  assert(hour>=9,'Gerçek saatli eski worker provası Türkiye saati 09:00–24:00 arasında çalıştırılmalı');report.dbGunu=today;report.dbSaati=hour;
  const earlier=new Date(new Date(today).getTime()-3*86400000);
  const tx=(f,fn)=>baglamlaCalistir({...f,rol:'yonetici'},()=>db.tenantIslem(f.tenantId,fn,{timeout:15000}));
  async function seed(){const tenantId=randomUUID();return db.tenantIslem(tenantId,async t=>{
   await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:'Özel worker izole fixture'}});const user=await t.user.create({data:{tenantId,eposta:tenantId+'@test.invalid',parolaHash:'test',adSoyad:'Fixture',rol:'yonetici'}});
   const cari=await t.cariHesap.create({data:{tenantId,kod:'C1',unvan:'Test müşteri',tip:'musteri',eposta:tenantId+'@example.invalid'}});
   await t.modulAyar.create({data:{tenantId,modul:'tahsilat_operasyonu',ayarlar:{mod:'pilot'}}});return {tenantId,userId:user.id,cariId:cari.id};
  });}
  async function promise(f){return tx(f,async t=>{const invoice=await t.fatura.create({data:{tenantId:f.tenantId,cariId:f.cariId,tip:'satis',durum:'kesin',tarih:earlier,dovizCinsi:'TRY',kur:'1',genelToplam:'2000',toplamBrut:'2000',toplamMatrah:'2000',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamKdv:'0',toplamTevkifat:'0',toplamNetKdv:'0'}});return t.odemeSozu.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:invoice.id,dovizCinsi:'TRY',tutar:'1000',sozTarihi:new Date(today),verildigiZaman:earlier,olusturanUserId:f.userId,aciklama:'Yalnız izole worker provası',istekAnahtari:randomUUID(),girdiOzeti:'a'.repeat(64)}});});}
  const f=await seed(),g=await seed(),soz=await promise(f),foreign=await promise(g),uncertain=await promise(f);
  await tx(f,t=>t.odemeSozuHatirlatma.create({data:{tenantId:f.tenantId,sozId:uncertain.id,alici:f.tenantId+'@example.invalid',konu:'Kesilmiş gönderim fixture',baslangicAt:new Date(clock.zaman.getTime()-11*60000)}}));
  await docker(['network','create','--internal',network]);networkCreated=true;await docker(['network','connect','--alias','pg',network,container]);pgAttached=true;
  const smtp=await start('smtp',['--network',network,'--network-alias','smtp','--memory=96m','--read-only','--tmpfs','/tmp:rw,size=32m','--mount','type=bind,source='+resolve(root,'apps/api/scripts/f04-smtp-fixture.cjs')+',target=/test.cjs,readonly','-e','TEKIR_TEST_SMTP_NONCE='+nonce,'--entrypoint','node',nodeImage,'/test.cjs']);await ready(smtp,8025);
  const args=['--network',network,'--memory=384m','--read-only','--tmpfs','/tmp:rw,size=64m','-w','/runtime','--mount','type=bind,source='+output+',target=/runtime,readonly','-e','NODE_ENV=production','-e','NODE_PATH=','-e','DATABASE_URL=postgresql://tekir_app:'+password+'@pg:5432/'+database,'-e','TEKIR_WORKER=0','-e','TEKIR_ODEME_SOZU_WORKER=1','-e','ODEME_SOZU_HATIRLATMA_TENANT_ID='+f.tenantId,'-e','ODEME_SOZU_WORKER_PORT=9467','-e','SMTP_HOST=smtp','-e','SMTP_PORT=1025','--entrypoint','node',nodeImage,'/runtime/apps/api/dist/main.odeme-sozu-worker.js'];
  const workers=[];
  await check('iki_ozel_worker_sureci_gercek_giris_ve_saglik',async()=>{workers.push(await start('worker-a',args),await start('worker-b',args));for(const w of workers)await ready(w,9467);return {surecAdedi:2,ilkTaramaTamamlandi:true};});
  const messages=async()=>JSON.parse(await get(smtp,8025,'/messages'));
  const reminder=(f,id)=>tx(f,t=>t.odemeSozuHatirlatma.findUnique({where:{tenantId_sozId:{tenantId:f.tenantId,sozId:id}}}));
  await check('gercek_smtp_mime_ve_db_gonderim_gecmisi',async()=>{const all=await messages();assert.equal(all.length,1);const mail=await req('mailparser').simpleParser(all[0]);assert.equal(mail.messageId,`<odeme-sozu-${soz.id}@tekirextra.local>`);assert.equal(mail.to.value[0].address,f.tenantId+'@example.invalid');assert(mail.text.includes('1000.00 TRY'));const r=await reminder(f,soz.id);assert.equal(r.durum,'gonderildi');assert.equal(r.deneme,1);assert.equal(await tx(f,t=>t.epostaGonderim.count({where:{tur:'odeme_sozu_hatirlatma',durum:'gonderildi'}})),1);return {iletiAdedi:1,messageIdKorundu:true,dbDeneme:1};});
  await check('tenant_siniri_ve_yarim_gonderim_tekrar_edilmez',async()=>{assert.equal(await reminder(g,foreign.id),null);assert.equal(await tx(g,t=>t.epostaGonderim.count()),0);assert.equal((await reminder(f,uncertain.id)).durum,'belirsiz');assert.equal((await messages()).length,1);return {baskaTenantAtlandi:true,kesilmisGonderim:'belirsiz'};});
  async function restart(){await docker(['restart','--time','3',...workers]);for(const w of workers)await ready(w,9467);}
  await check('iki_worker_yeniden_baslatma_tekilligi',async()=>{await restart();assert.equal((await messages()).length,1);assert.equal((await reminder(f,soz.id)).deneme,1);assert.equal((await reminder(f,uncertain.id)).durum,'belirsiz');return {iletiAdedi:1};});
  let pending;
  await check('salt_okunur_tahsilat_modu_yeni_gonderimi_durdurur',async()=>{await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'tahsilat_operasyonu'}},data:{ayarlar:{mod:'salt_okunur'}}}));pending=await promise(f);await restart();assert.equal((await messages()).length,1);assert.equal(await reminder(f,pending.id),null);return {yeniHatirlatmaYok:true};});
  await check('pilot_yeniden_acilinca_yeni_soz_bir_kez_gonderilir',async()=>{await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'tahsilat_operasyonu'}},data:{ayarlar:{mod:'pilot'}}}));await restart();const all=await messages();assert.equal(all.length,2);assert.equal((await reminder(f,pending.id)).durum,'gonderildi');assert.equal((await reminder(f,pending.id)).deneme,1);assert.equal(await reminder(g,foreign.id),null);return {toplamIleti:2};});
  if(devir){
   async function state(w){return JSON.parse(await docker(['inspect','--format','{{json .State}}',w]));}
   async function stopped(w){const r=await state(w);assert.equal(r.Running,false);assert.equal(r.OOMKilled,false);assert([0,143].includes(r.ExitCode),'Worker SIGTERM ile kapanmadı: '+r.ExitCode);return {exitCode:r.ExitCode,oom:r.OOMKilled};}
   const prior=[soz.id,pending.id];let next;
   await check('eski_workerlar_durmadan_yeni_ise_baslanmaz',async()=>{
    await docker(['stop','--time','10',...workers]);const states=[];for(const w of workers)states.push(await stopped(w));
    next=await promise(f);assert.equal(await reminder(f,next.id),null);assert.equal((await messages()).length,2);return {eskiSurecAdedi:2,states,yeniIsDuranSureclerdenSonraOlustu:true};
   });
   const oldGen=resolve(dirname(req.resolve('@prisma/client/package.json')),'../../.prisma/client');assert(!relative(output,oldGen).startsWith('..'));
   const overlay=['--mount','type=bind,source='+resolve(newPackage,'dist')+',target=/runtime/apps/api/dist,readonly','--mount','type=bind,source='+resolve(newPackage,'prisma-client')+',target=/runtime/'+relative(output,oldGen)+',readonly'];
   for(const name of ['shared','baglanti'])overlay.push('--mount','type=bind,source='+resolve(newPackage,name)+',target=/runtime/packages/'+name+'/dist,readonly');
   // args'ın son dört elemanı entrypoint/node/image/giriş dosyasıdır.
   const current=await start('worker-yeni',[...args.slice(0,-4),...overlay,...args.slice(-4)]);
   await check('guncel_worker_yeni_isi_isler_eski_gonderimleri_tekrarlamaz',async()=>{
    await ready(current,9467);for(const w of workers)await stopped(w);
    const all=await messages();assert.equal(all.length,3);const mails=await Promise.all(all.map(raw=>req('mailparser').simpleParser(raw)));assert.equal(new Set(mails.map(m=>m.messageId)).size,3);assert(mails.some(m=>m.messageId===`<odeme-sozu-${next.id}@tekirextra.local>`));
    for(const id of [...prior,next.id]){const r=await reminder(f,id);assert.equal(r.durum,'gonderildi');assert.equal(r.deneme,1);}assert.equal((await reminder(f,uncertain.id)).durum,'belirsiz');assert.equal(await reminder(g,foreign.id),null);
    assert.equal(await tx(f,t=>t.epostaGonderim.count({where:{tur:'odeme_sozu_hatirlatma',durum:'gonderildi'}})),3);return {toplamIleti:3,eskiSureclerKapali:true,gecmisDenemeSayilari:1};
   });
   await check('guncel_worker_yeniden_baslatma_gonderim_sayisini_artirmaz',async()=>{await docker(['restart','--time','10',current]);await ready(current,9467);assert.equal((await messages()).length,3);for(const w of workers)await stopped(w);return {toplamIleti:3};});
   await check('eski_workera_geri_donus_yeni_kayitlari_tekrarlamaz',async()=>{
    await docker(['stop','--time','10',current]);const currentStopped=await stopped(current);const returned=await promise(f);await docker(['start',workers[0]]);await ready(workers[0],9467);await stopped(current);await stopped(workers[1]);
    const all=await messages();assert.equal(all.length,4);const mails=await Promise.all(all.map(raw=>req('mailparser').simpleParser(raw)));assert.equal(new Set(mails.map(m=>m.messageId)).size,4);assert(mails.some(m=>m.messageId===`<odeme-sozu-${returned.id}@tekirextra.local>`));
    for(const id of [...prior,next.id,returned.id]){const r=await reminder(f,id);assert.equal(r.durum,'gonderildi');assert.equal(r.deneme,1);}assert.equal((await reminder(f,uncertain.id)).durum,'belirsiz');assert.equal(await reminder(g,foreign.id),null);assert.equal(await tx(f,t=>t.epostaGonderim.count({where:{tur:'odeme_sozu_hatirlatma',durum:'gonderildi'}})),4);
    return {toplamIleti:4,guncelSurecKapali:currentStopped,etkinEskiSurecAdedi:1};
   });
   await verifyNew();
  }
  await check('f04_plan_bag_ayar_audit_korunur',async()=>{assert.equal(await fingerprint(),before);return {tabloAdedi:5,ayarAuditDahil:true,kayitOzeti:sha(before)};});
  await verify();report.durum='gecti';report.testAdedi=report.kontroller.length;
 }catch(e){report.durum='basarisiz';report.hata=sanitize(e.stack||e);throw e;}
 finally{
  report.logs={};for(const name of names)if(name.includes('-worker-'))report.logs[name]=sanitize(await docker(['logs','--tail','8',name]).catch(e=>e.message));
  await db?.$disconnect();const errors=[];for(const name of [...names].reverse())try{await docker(['stop','--time','3',name]);await docker(['rm',name]);}catch(e){errors.push(sanitize(e.message));}
  if(pgAttached)try{await docker(['network','disconnect',network,container]);}catch(e){errors.push(sanitize(e.message));}if(networkCreated)try{await docker(['network','rm',network]);}catch(e){errors.push(sanitize(e.message));}
  report.temizlik=errors.length===0;report.temizlikHatalari=errors;report.bitis=new Date().toISOString();report.betikSha256=sha(await fs.readFile(import.meta.filename));if(!report.temizlik)report.durum='basarisiz';await fs.writeFile(resolve(evidence,'ozel-worker-geri-donus.json'),JSON.stringify(report,null,2)+'\n');if(!report.temizlik)throw Error('Özel worker test kaynakları temizlenemedi');
 }
 return report;
}
