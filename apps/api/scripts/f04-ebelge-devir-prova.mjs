import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Canlı adres/paket almaz; yalnız nonce doğrulanmış restore DB ve internal test ağı.
export async function ebelgeDevriniProvaEt({db,tx,f,nonce,database,sql,docker,run,api,worker,current,stopped,readyWorker,check,aktifKesinti=false}){
  assert(/^[a-f0-9]{16}$/.test(nonce));assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  const g={tenantId:randomUUID(),userId:randomUUID()};
  await db.tenantIslem(g.tenantId,async t=>{
    await t.tenant.create({data:{id:g.tenantId,vkn:g.tenantId,unvan:'İzole e-belge diğer tenant'}});
    await t.user.create({data:{id:g.userId,tenantId:g.tenantId,eposta:g.userId+'@test.invalid',parolaHash:'fixture',adSoyad:'Fixture',rol:'yonetici'}});
  });
  assert.equal(await tx(t=>t.baglanti.count({where:{aile:'ebelge',durum:'aktif'}})),0);
  assert.equal(await db.tenantIslem(g.tenantId,t=>t.baglanti.count({where:{aile:'ebelge',durum:'aktif'}})),0);
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const snapshot=async()=>JSON.stringify(await tx(async t=>({invoice:await t.fatura.findUnique({where:{id:f.faturaId}}),ebelge:await t.ebelgeKayit.findMany({orderBy:{id:'asc'}})})));
  const before=await snapshot(),missing=randomUUID(),ids=[];
  async function queue(action,id,type='ebelge-durum-sorgula',owner=f,invoiceId=missing){
    const code="const {Queue}=require('bullmq');const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const connection={host:'redis',port:6379,maxRetriesPerRequest:null};const q=new Queue('tekirextra-ebelge',{connection});const d=new Queue('tekirextra-ebelge-dead-letter',{connection});(async()=>{try{if(x.action==='replace'){const j=await q.getJob(x.id);if(j)await j.remove();}if(x.action==='add'||x.action==='replace')await q.add(x.type,x.data,{jobId:x.id,attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:false,removeOnFail:false});const j=await q.getJob(x.id),dlq=await d.getJob('dead-'+x.id);console.log(JSON.stringify({id:j.id,state:await j.getState(),attempts:j.attemptsMade,attemptsStarted:j.attemptsStarted,stalledCounter:j.stalledCounter,lockTtl:await (await q.getBackend().client).pttl(q.toKey(j.id)+':lock'),result:j.returnvalue,failedReason:j.failedReason,dead:dlq?{id:dlq.id,name:dlq.name,data:dlq.data,state:await dlq.getState()}:null}));}finally{await q.close();await d.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});";
    return JSON.parse(await run('docker',['exec','-i','-w','/runtime/apps/api',api,'node','-e',code],JSON.stringify({action,id,type,data:{tenantId:owner.tenantId,userId:owner.userId,rol:'yonetici',isTuru:type,faturaId:invoiceId,correlationId:randomUUID(),kuyrugaAlinmaZamani:new Date().toISOString()}})));
  }
  async function terminal(id,kind){
    let r;
    for(let i=0;i<100;i++){
      r=await queue('read',id);if(r.state===(kind==='failed'?'failed':'completed')&&(kind!=='failed'||r.dead))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(r.state,kind==='failed'?'failed':'completed');assert.equal(r.attempts,1);assert.equal(r.attemptsStarted,1);assert.equal(r.stalledCounter,0);
    if(kind==='failed'){
      assert.equal(r.failedReason,'Fatura bulunamadı');assert(r.dead);assert.equal(r.dead.id,'dead-'+id);assert.equal(r.dead.data.asilIsId,id);assert.equal(r.dead.data.hata,'Fatura bulunamadı');assert.equal(r.dead.state,'waiting');
    }else{
      assert.equal(r.result.atlandi,true);assert.equal(r.result.neden,kind==='guard'?'dead-letter kaydı mevcut':'Faturaya ait e-belge kaydı bulunamadı');if(kind==='skip')assert.equal(r.dead,null);
    }
    return r;
  }
  const id=s=>'f04-'+nonce+'-ebelge-'+s;
  const oldStatus=id('eski-durum'),oldSend=id('eski-gonder'),newStatus=id('yeni-durum'),newSend=id('yeni-gonder'),returnStatus=id('geri-durum'),foreignSend=id('baska-tenant');
  let oldDead,newDead,stable;
  await check('eski_ebelge_worker_kayitsiz_durumu_saglayicisiz_atlar',async()=>{
    await stopped(current);await queue('add',oldStatus);ids.push([oldStatus,'skip']);await terminal(oldStatus,'skip');return {completed:true,atlandi:true,deadLetter:false};
  });
  await check('eski_ebelge_worker_kalici_reddi_bir_deneme_ile_dead_lettera_tasir',async()=>{
    await queue('add',oldSend,'ebelge-gonder');ids.push([oldSend,'failed']);const r=await terminal(oldSend,'failed');oldDead=JSON.stringify(r.dead);assert.equal(r.dead.data.tenantId,f.tenantId);return {attempts:1,ayarlananAttempts:5,deadLetterId:r.dead.id};
  });
  await check('ebelge_eski_worker_durunca_yeni_isler_bekler',async()=>{
    await docker(['stop','--time','15',worker]);const state=await stopped(worker);
    assert.equal((await queue('add',newStatus)).state,'waiting');assert.equal((await queue('add',newSend,'ebelge-gonder')).state,'waiting');return state;
  });
  await check('guncel_ebelge_worker_bekleyen_isleri_alir_eski_dead_letter_korunur',async()=>{
    await docker(['start',current]);await readyWorker(current);await stopped(worker);
    ids.push([newStatus,'skip'],[newSend,'failed']);await terminal(newStatus,'skip');const r=await terminal(newSend,'failed');newDead=JSON.stringify(r.dead);assert.equal(r.dead.data.tenantId,f.tenantId);
    assert.equal(JSON.stringify((await terminal(oldSend,'failed')).dead),oldDead);stable=await Promise.all(ids.map(async([i,k])=>terminal(i,k)));return {bekleyenIsAdedi:2,eskiDeadLetterKorundu:true};
  });
  await check('guncel_ebelge_restart_tamamlanan_ve_dead_letter_isleri_tekrarlamaz',async()=>{
    await docker(['restart','--time','15',current]);await readyWorker(current);await stopped(worker);
    assert.deepEqual(await Promise.all(ids.map(([i,k])=>terminal(i,k))),stable);return {isAdedi:4,herIsDeneme:1};
  });
  await check('dead_letter_ayni_is_kimliginin_yeniden_gonderimini_engeller',async()=>{
    // Yalnız sentetik ana job yeniden eklenir; DLQ'ya dokunulmaz. HTTP kullanıcı retry testi değildir.
    await queue('replace',oldSend,'ebelge-gonder');const r=await terminal(oldSend,'guard');assert.equal(JSON.stringify(r.dead),oldDead);ids[1][1]='guard';return {atlandi:true,deadLetterDegismedi:true};
  });
  await check('eski_ebelgeye_geri_donus_ve_baska_tenant_faturasi_korunur',async()=>{
    await docker(['stop','--time','15',current]);await stopped(current);
    assert.equal((await queue('add',returnStatus)).state,'waiting');assert.equal((await queue('add',foreignSend,'ebelge-gonder',g,f.faturaId)).state,'waiting');
    await docker(['start',worker]);await readyWorker(worker);await stopped(current);ids.push([returnStatus,'skip'],[foreignSend,'failed']);
    await terminal(returnStatus,'skip');const foreign=await terminal(foreignSend,'failed');assert.equal(foreign.dead.data.tenantId,g.tenantId);assert.equal(foreign.dead.data.faturaId,f.faturaId);
    assert.equal(JSON.stringify((await terminal(oldSend,'guard')).dead),oldDead);assert.equal(JSON.stringify((await terminal(newSend,'failed')).dead),newDead);return {yeniIsAdedi:2,baskaTenant:'Fatura bulunamadı',oncekiDeadLetterlarKorundu:true};
  });
  await check('ebelge_devir_sonrasi_restart_ve_db_kayitlari_korunur',async()=>{
    const stable=await Promise.all(ids.map(([i,k])=>terminal(i,k)));
    await docker(['restart','--time','15',worker]);await readyWorker(worker);await stopped(current);
    assert.deepEqual(await Promise.all(ids.map(([i,k])=>terminal(i,k))),stable);assert.equal(await snapshot(),before);
    assert.equal(await db.tenantIslem(g.tenantId,t=>t.ebelgeKayit.count()),0);return {isAdedi:6,faturaVeEbelgeOzeti:sha(before),digerTenantEbelgeAdedi:0};
  });
  let aktifIs;
  if(aktifKesinti){
    const stable=await Promise.all(ids.map(([i,k])=>terminal(i,k)));
    const {aktifEbelgeyiProvaEt}=await import('./f04-ebelge-aktif-prova.mjs');
    aktifIs=await aktifEbelgeyiProvaEt({db,nonce,database,sql,docker,queue,worker,current,stopped,readyWorker,check,snapshot});
    assert.deepEqual(await Promise.all(ids.map(([i,k])=>terminal(i,k))),stable);assert.equal(await snapshot(),before);
  }
  return {durum:'gecti',isAdedi:6,gercekSaglayiciKullanildi:false,yerelRetVeDeadLetter:true,aktifIs,faturaVeEbelgeOzeti:sha(before),betikSha256:sha(await readFile(import.meta.filename))};
}
