import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Bağlantı kurmaz; yalnız kendi restore DB'sini doğrulamış tam paket runner'ı çağırır.
export async function aktifIsiProvaEt({db,tx,f,sql,database,nonce,docker,queue,worker,current,stopped,readyWorker,check}){
  assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));
  assert(/^[a-f0-9]{16}$/.test(nonce));
  const [{db:actual,nonce:actualNonce}]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce");
  assert.equal(actual,database);assert.equal(actualNonce,nonce);
  const person=await tx(t=>t.personel.create({data:{tenantId:f.tenantId,personelNo:'F04-AKTIF',ad:'İzole',soyad:'Worker',girisTarihi:new Date('2026-01-01'),netMaas:'30000',istihdamDonemleri:{create:{tenantId:f.tenantId,baslangicTarihi:new Date('2026-01-01')}},ucretler:{create:{tenantId:f.tenantId,yururlukTarihi:new Date('2026-01-01'),tip:'net',tutar:'30000'}}}}));
  const id=suffix=>'f04-'+nonce+'-aktif-'+suffix;
  const result=created=>({olusturulanSayi:created,toplamAktifPersonel:1,mevcutSayi:1-created,hatalar:[]});
  async function complete(jobId,created){
    let r;
    for(let i=0;i<100;i++){
      r=await queue('read',jobId);if(r.state==='completed')break;
      assert.notEqual(r.state,'failed',r.failedReason);await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(r.state,'completed');assert.equal(r.attempts,1);assert.deepEqual(r.result,result(created));return r;
  }
  const payroll=()=>tx(t=>t.personelBordro.findMany({where:{personelId:person.id},include:{kalemler:{orderBy:{id:'asc'}}},orderBy:{id:'asc'}}));
  const fingerprint=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  async function drain(w,jobId,created){
    const addresses=Object.values(JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',w]))).map(n=>n.IPAddress);
    assert.equal(addresses.length,1);assert(/^\d+\.\d+\.\d+\.\d+$/.test(addresses[0]));
    let release,announce;
    const gate=new Promise(resolve=>{release=resolve;}),acquired=new Promise(resolve=>{announce=resolve;});
    // Kısa gerçek DB beklemesi: uygulama transaction süresi (5 sn) aşılmamalı.
    // Ayrı bağlantı kilidi tutar; ürün kodu ve paket dosyaları değiştirilmez.
    const holding=db.$transaction(async t=>{
      await t.$executeRawUnsafe('LOCK TABLE public.personel_bordro IN ACCESS EXCLUSIVE MODE');
      const [{pid}]=await t.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announce(pid);await gate;
    },{timeout:30000});
    // Kilit alınamadığında acquired beklemesi de reddedilir; unhandled rejection yok.
    let blockerPid,blockedPid,signalAt,elapsed;
    try{
      blockerPid=await Promise.race([acquired,holding.then(()=>{throw Error('Kilit alınmadan transaction bitti');})]);
      assert(Number.isInteger(blockerPid));await queue('add',jobId);
      const deadline=Date.now()+2500;
      while(Date.now()<deadline){
        const rows=await sql(database,`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename='tekir_app' AND a.client_addr='${addresses[0]}'::inet AND ${blockerPid}=ANY(pg_blocking_pids(a.pid)) AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='public.personel_bordro'::regclass AND NOT l.granted) ORDER BY a.pid LIMIT 1`);
        if(/^\d+$/.test(rows)){blockedPid=Number(rows);break;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!blockedPid){
        const status=await queue('read',jobId);
        const locks=await sql(database,`SELECT a.pid,a.client_addr,a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid)::text FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename='tekir_app'`);
        throw Error('Gerçek worker sorgusu kilitte beklemedi: '+JSON.stringify({status,blockerPid,workerAddress:addresses[0],locks}));
      }
      assert.equal((await queue('read',jobId)).state,'active');
      signalAt=Date.now();await docker(['kill','--signal=TERM',w]);
      const state=JSON.parse(await docker(['inspect','--format','{{json .State}}',w]));
      assert.equal(state.Running,true,'Worker aktif iş tamamlanmadan çıktı');assert.equal(state.OOMKilled,false);
      assert.equal((await queue('read',jobId)).state,'active');
      // Kilit bırakılmadan işin hâlâ DB'de beklediğini ikinci kez doğrula.
      assert.equal(await sql(database,`SELECT count(*) FROM pg_stat_activity WHERE pid=${blockedPid} AND ${blockerPid}=ANY(pg_blocking_pids(pid))`),'1');
      elapsed=Date.now()-signalAt;
    }finally{release();await holding;}
    const completed=await complete(jobId,created);
    for(let i=0;i<100;i++){
      if(await docker(['inspect','--format','{{.State.Running}}',w])==='false')break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const state=await stopped(w);
    return {jobId,aktifIsDogrulandi:true,dbBekleyenPid:blockedPid,sigtermSonrasiKilitTutmaMs:elapsed,...state,attempts:completed.attempts,sonuc:completed.result};
  }
  let baseline;
  await check('eski_worker_aktif_bordro_isini_sigterm_sonrasi_tamamlar',async()=>{
    await stopped(current);const detail=await drain(worker,id('eski'),1);
    const rows=await payroll();assert.equal(rows.length,1);assert(rows[0].kalemler.length>0);assert.equal(rows[0].netMaas.toFixed(2),'30000.00');
    baseline=fingerprint(rows);return {...detail,bordroAdedi:1,kalemAdedi:rows[0].kalemler.length,bordroOzeti:baseline};
  });
  await check('guncel_worker_dolu_kadro_bekleyen_isi_devralir_bordro_korunur',async()=>{
    assert.equal((await queue('add',id('bekleyen-yeni'))).state,'waiting');await docker(['start',current]);await readyWorker(current);await stopped(worker);
    await complete(id('bekleyen-yeni'),0);await complete(id('eski'),1);assert.equal(fingerprint(await payroll()),baseline);return {bordroAdedi:1,herIsDeneme:1};
  });
  await check('guncel_worker_aktif_iste_sigterm_sonrasi_normal_kapanir',async()=>{
    const detail=await drain(current,id('yeni'),0);assert.equal(fingerprint(await payroll()),baseline);return detail;
  });
  await check('eskiye_donus_ve_restart_aktif_isleri_ve_bordroyu_tekrarlamaz',async()=>{
    assert.equal((await queue('add',id('bekleyen-geri'))).state,'waiting');await docker(['start',worker]);await readyWorker(worker);await stopped(current);
    await complete(id('bekleyen-geri'),0);await docker(['restart','--time','15',worker]);await readyWorker(worker);await stopped(current);
    for(const [suffix,created] of [['eski',1],['bekleyen-yeni',0],['yeni',0],['bekleyen-geri',0]])await complete(id(suffix),created);
    assert.equal(fingerprint(await payroll()),baseline);return {isAdedi:4,bordroAdedi:1,herIsDeneme:1,bordroOzeti:baseline};
  });
  return {durum:'gecti',personelAdedi:1,isAdedi:4,bordroAdedi:1,bordroOzeti:baseline,betikSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex')};
}
