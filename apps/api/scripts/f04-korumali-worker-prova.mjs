import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createCipheriv,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';

export async function korumaliWorkeriProvaEt({db,database,nonce,docker,run,api,worker,current,stopped,readyWorker,check,start,network,nodeImage,connectionKey,personelQueue}){
  assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));assert(/^[a-f0-9]{16}$/.test(nonce));assert(/^[a-f0-9]{64}$/.test(connectionKey));
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  const root=resolve(import.meta.dirname,'../../..'),f={tenantId:randomUUID(),userId:randomUUID()},invoiceIds=[randomUUID(),randomUUID(),randomUUID()];
  const tx=fn=>db.tenantIslem(f.tenantId,fn,{timeout:30000});
  const fixture=await start('sovos',['--network',network,'--network-alias','sovos','--memory=96m','--read-only','--mount','type=bind,source='+resolve(root,'apps/api/scripts/f04-sovos-fixture.cjs')+',target=/test.cjs,readonly','-e','TEKIR_TEST_EBELGE_NONCE='+nonce,'--entrypoint','node',nodeImage,'/test.cjs']);
  async function proof(){return JSON.parse(await run('docker',['exec',api,'node','-e',"fetch('http://sovos:8080/proof',{signal:AbortSignal.timeout(5000)}).then(async r=>console.log(await r.text())).catch(e=>{console.error(e.message);process.exitCode=1})"]));}
  for(let i=0;i<50;i++){try{await proof();break;}catch{if(i===49)throw Error('SOAP fixture başlamadı');await new Promise(r=>setTimeout(r,100));}}
  async function queue(action,id,invoiceId,attempts=5){
    const code="const {Queue}=require('bullmq');const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const connection={host:'redis',port:6379,maxRetriesPerRequest:null};const q=new Queue('tekirextra-ebelge',{connection}),d=new Queue('tekirextra-ebelge-dead-letter',{connection});(async()=>{try{if(x.action==='pause')await q.pause();if(x.action==='resume')await q.resume();if(x.action==='add')await q.add('ebelge-gonder',x.data,{jobId:x.id,attempts:x.attempts,backoff:{type:'exponential',delay:5000},removeOnComplete:false,removeOnFail:false});const j=x.id?await q.getJob(x.id):null,dead=x.id?await d.getJob('dead-'+x.id):null;console.log(JSON.stringify({paused:await q.isPaused(),active:(await q.getJobCounts('active')).active,...(j?{id:j.id,state:await j.getState(),attempts:j.attemptsMade,attemptsStarted:j.attemptsStarted,result:j.returnvalue,failedReason:j.failedReason,dead:dead?{id:dead.id,data:dead.data,state:await dead.getState()}:null}:{})}));}finally{await q.close();await d.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});";
    return JSON.parse(await run('docker',['exec','-i','-w','/runtime/apps/api',api,'node','-e',code],JSON.stringify({action,id,attempts,data:{...f,rol:'yonetici',isTuru:'ebelge-gonder',faturaId:invoiceId,correlationId:randomUUID(),kuyrugaAlinmaZamani:new Date().toISOString()}})));
  }
  const firstId='f04-'+nonce+'-korumali-ilk',retryId='f04-'+nonce+'-korumali-tekrar',rollbackId='f04-'+nonce+'-korumali-geri';
  const record=id=>tx(t=>t.ebelgeKayit.findUnique({where:{faturaId:id},include:{arsiv:true}}));
  const financial=()=>tx(async t=>JSON.stringify({invoices:await t.fatura.findMany({orderBy:{id:'asc'},include:{satirlar:{orderBy:{id:'asc'}}}}),cari:await t.cariHareket.count(),stok:await t.stokHareket.count()}));
  async function terminal(id,failed,attempts){
    const deadline=Date.now()+180000;let r,lastLog=Date.now();
    while(Date.now()<deadline){
      r=await queue('read',id);if(failed?r.state==='failed'&&r.dead:r.state==='completed')break;
      if(Date.now()-lastLog>15000){console.log('Korumalı worker: doğal backoff bekleniyor; deneme '+r.attempts);lastLog=Date.now();}await new Promise(ok=>setTimeout(ok,1000));
    }
    assert.equal(r.state,failed?'failed':'completed');assert.equal(r.attempts,attempts);assert.equal(r.attemptsStarted,attempts);
    if(failed){assert(r.failedReason.includes('arama desteği sunmuyor'));assert.equal(r.dead.id,'dead-'+id);assert.equal(r.dead.data.asilIsId,id);assert.equal(r.dead.data.tenantId,f.tenantId);assert.equal(r.dead.state,'waiting');}
    else{assert.equal(r.result.basarili,true);assert.equal(r.result.ebelgeRef,'EARSIV:'+invoiceIds[0]);assert.equal(r.dead,null);}
    const {paused,active,...job}=r;return job;
  }
  let first,failed,financialBefore,firstRecord;
  await check('korumali_tam_worker_gercek_sovos_adapter_ve_internal_soap_hazir',async()=>{
    await queue('pause');await docker(['stop','--time','15',worker]);await stopped(worker);await stopped(current);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(connectionKey,'hex'),iv);
    const config={kullaniciAdi:'fixture',parola:'fixture',testOrtami:true,earsivServisAdresi:'http://sovos:8080/'+nonce,vknTckn:'1234567890'};
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);const sifreliConfig=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
    await tx(async t=>{
      await t.tenant.create({data:{id:f.tenantId,vkn:(BigInt('0x'+randomBytes(5).toString('hex'))%10000000000n).toString().padStart(10,'0'),unvan:'İzole tam worker SOAP fixture',efaturaMukellefi:false,earsivMukellefi:true,eirsaliyeMukellefi:false,vergiDairesi:'Test',adres:'Test sokak 1',ilce:'Kadıköy',il:'İstanbul'}});
      await t.user.create({data:{id:f.userId,tenantId:f.tenantId,eposta:f.userId+'@test.invalid',adSoyad:'Fixture',parolaHash:'fixture',rol:'yonetici'}});
      const cari=await t.cariHesap.create({data:{tenantId:f.tenantId,kod:'C1',unvan:'Fixture alıcı',tip:'musteri',vknTckn:'1234567890'}}),stock=await t.stokKart.create({data:{tenantId:f.tenantId,kod:'H1',ad:'Fixture hizmet',tip:'hizmet',anaBirim:'adet'}});
      await t.baglanti.create({data:{tenantId:f.tenantId,aile:'ebelge',saglayici:'sovos',durum:'aktif',sifreliConfig}});
      for(const [index,id] of invoiceIds.entries()){
        await t.fatura.create({data:{id,tenantId:f.tenantId,cariId:cari.id,tip:'satis',durum:'kesin',no:'FXT2026'+String(index+1).padStart(9,'0'),tarih:new Date(),dovizCinsi:'TRY',kur:'1',toplamBrut:'100',toplamMatrah:'100',toplamKdv:'20',genelToplam:'120',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamTevkifat:'0',toplamNetKdv:'20',satirlar:{create:{tenantId:f.tenantId,stokId:stock.id,miktar:'1',birim:'adet',birimFiyat:'100',matrah:'100',kdvOrani:'20',kdvTutari:'20',netKdvTutari:'20',toplamTutar:'120'}}}});
        if(index>0)await t.ebelgeKayit.create({data:{tenantId:f.tenantId,faturaId:id,tur:'earsiv',durum:'hata',hataMesaji:'Önceki teslim belirsiz fixture'}});
      }
    });financialBefore=await financial();await docker(['start',current]);await readyWorker(current);assert.equal((await queue('read')).paused,true);return {saglayici:'sovos',gercekAdapter:true,gercekSaglayici:false,fixture};
  });
  await check('korumali_worker_ilk_gonderimi_tek_soap_ile_yapar_ve_arsivler',async()=>{
    await queue('add',firstId,invoiceIds[0]);await queue('resume');first=await terminal(firstId,false,1);firstRecord=await record(invoiceIds[0]);assert(firstRecord.arsiv.xmlIcerik.includes(invoiceIds[0]));assert.equal(firstRecord.entegratorRef,'EARSIV:'+invoiceIds[0]);assert.equal((await proof()).sends[invoiceIds[0]],1);return {attempts:1,soapGonderim:1,xmlArsiv:true};
  });
  await check('korumali_worker_desteksiz_yeniden_gonderimi_dogal_bes_deneme_sonrasi_dlq_ile_kapatir',async()=>{
    const began=Date.now();await queue('add',retryId,invoiceIds[1]);failed=await terminal(retryId,true,5);assert.equal((await proof()).sends[invoiceIds[1]]??0,0);assert.equal((await record(invoiceIds[1])).durum,'hata');return {attempts:5,azamiAttempts:5,beklemeMs:Date.now()-began,soapGonderim:0,deadLetterId:failed.dead.id};
  });
  await check('korumali_worker_restart_sonuclari_dlq_ve_tek_gonderimi_korur',async()=>{
    await docker(['restart','--time','15',current]);await readyWorker(current);await stopped(worker);assert.deepEqual(await terminal(firstId,false,1),first);assert.deepEqual(await terminal(retryId,true,5),failed);assert.equal((await proof()).sends[invoiceIds[0]],1);return {soapGonderim:1,deadLetterKorundu:true};
  });
  await check('eskiye_geri_donuste_ebelge_kuyrugu_pause_ve_sifir_aktif_is_gerektirir',async()=>{
    await queue('pause');let q;for(let i=0;i<50;i++){q=await queue('read');if(q.active===0)break;await new Promise(r=>setTimeout(r,100));}assert.equal(q.active,0);assert.equal(q.paused,true);
    await docker(['stop','--time','15',current]);await stopped(current);await queue('add',rollbackId,invoiceIds[2],1);await docker(['start',worker]);await readyWorker(worker);await stopped(current);
    const pId='f04-'+nonce+'-rollback-personel';await personelQueue('add',pId);let p;for(let i=0;i<100;i++){p=await personelQueue('read',pId);if(p.state==='completed')break;await new Promise(r=>setTimeout(r,100));}assert.equal(p.state,'completed');assert.equal(p.attempts,1);
    q=await queue('read',rollbackId);assert.equal(q.paused,true);assert.equal(q.active,0);assert.equal(q.attemptsStarted,0);assert.equal(q.attempts,0);assert.equal(q.dead,null);assert.equal((await proof()).sends[invoiceIds[2]]??0,0);return {ebelgePaused:true,aktifEbelge:0,bekleyenIsBaslamadi:true,personelKuyruguCalisti:true};
  });
  await check('korumali_workera_donus_sonrasi_resume_bekleyen_tekrari_gondermeden_reddeder',async()=>{
    await docker(['stop','--time','15',worker]);await stopped(worker);await docker(['start',current]);await readyWorker(current);assert.equal((await queue('read')).paused,true);
    await queue('resume');const r=await terminal(rollbackId,true,1);assert.equal((await proof()).sends[invoiceIds[2]]??0,0);assert.deepEqual(await terminal(retryId,true,5),failed);return {attempts:1,tekDenemeliFixture:true,soapGonderim:0,deadLetterId:r.dead.id};
  });
  await check('son_geri_donuste_ebelge_pause_kalir_finansal_kayitlar_ve_arsiv_korunur',async()=>{
    await queue('pause');let gate;for(let i=0;i<50;i++){gate=await queue('read');if(gate.active===0)break;await new Promise(r=>setTimeout(r,100));}assert.equal(gate.active,0);await docker(['stop','--time','15',current]);await stopped(current);await docker(['start',worker]);await readyWorker(worker);await stopped(current);assert.equal((await queue('read')).paused,true);
    assert.equal(await financial(),financialBefore);const r=await record(invoiceIds[0]);assert.equal(r.id,firstRecord.id);assert.equal(r.arsiv.id,firstRecord.arsiv.id);assert.equal(r.arsiv.xmlIcerik,firstRecord.arsiv.xmlIcerik);assert.equal(r.entegratorRef,firstRecord.entegratorRef);
    const counts=(await proof()).sends;assert.equal(counts[invoiceIds[0]],1);assert.equal(counts[invoiceIds[1]]??0,0);assert.equal(counts[invoiceIds[2]]??0,0);return {ebelgePaused:true,soapGonderim:1,faturaVeHareketlerKorundu:true};
  });
  return {durum:'gecti',gercekAdapter:'SovosEntegratorAdapter',gercekSaglayici:false,sonGeriDonusEbelgePaused:true,soapKaniti:await proof(),betikSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex')};
}
