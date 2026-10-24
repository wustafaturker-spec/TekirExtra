import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Yalnız doğrulanmış restore DB ve internal test kuyruğu. Sağlayıcıya çıkılmaz.
export async function aktifEbelgeyiProvaEt({db,nonce,database,sql,docker,queue,worker,current,stopped,readyWorker,check,snapshot}){
  assert(/^[a-f0-9]{16}$/.test(nonce));assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  const sha=s=>createHash('sha256').update(s).digest('hex'),before=await snapshot(),jobs=[],recoveries=[];
  async function state(w){return JSON.parse(await docker(['inspect','--format','{{json .State}}',w]));}
  async function killed(w){const r=await state(w);assert.equal(r.Running,false);assert.equal(r.OOMKilled,false);assert.equal(r.ExitCode,137);return r;}
  async function terminal(id,forced){
    let r;
    for(let i=0;i<100;i++){
      r=await queue('read',id);if(forced?r.state==='failed'&&r.dead:r.state==='completed')break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(r.state,forced?'failed':'completed');assert.equal(r.attempts,1);assert.equal(r.attemptsStarted,forced?2:1);assert.equal(r.stalledCounter,forced?1:0);assert.equal(r.lockTtl,-2);
    if(forced){
      assert.equal(r.failedReason,'Fatura bulunamadı');assert.equal(r.dead.id,'dead-'+id);assert.equal(r.dead.data.asilIsId,id);assert.equal(r.dead.data.hata,'Fatura bulunamadı');assert.equal(r.dead.state,'waiting');
    }else{assert.deepEqual(r.result,{atlandi:true,neden:'Faturaya ait e-belge kaydı bulunamadı'});assert.equal(r.dead,null);}
    return r;
  }
  async function interrupt(w,id,forced){
    const table=forced?'faturalar':'ebelge_kayitlari',type=forced?'ebelge-gonder':'ebelge-durum-sorgula';
    const addresses=Object.values(JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',w]))).map(n=>n.IPAddress);
    assert.equal(addresses.length,1);assert(/^\d+\.\d+\.\d+\.\d+$/.test(addresses[0]));
    let release,announce;
    const gate=new Promise(resolve=>{release=resolve;}),acquired=new Promise(resolve=>{announce=resolve;});
    const holding=db.$transaction(async t=>{
      await t.$executeRawUnsafe(`LOCK TABLE public.${table} IN ACCESS EXCLUSIVE MODE`);
      const [{pid}]=await t.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announce(pid);await gate;
    },{timeout:30000});
    let blockedPid,afterSignal,signalAt;
    try{
      const blocker=await Promise.race([acquired,holding.then(()=>{throw Error('Kilit alınmadan transaction bitti');})]);assert(Number.isInteger(blocker));
      await queue('add',id,type);
      const deadline=Date.now()+2500;
      while(Date.now()<deadline){
        const pid=await sql(database,`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename='tekir_app' AND a.client_addr='${addresses[0]}'::inet AND ${blocker}=ANY(pg_blocking_pids(a.pid)) AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='public.${table}'::regclass AND NOT l.granted) ORDER BY a.pid LIMIT 1`);
        if(/^\d+$/.test(pid)){blockedPid=Number(pid);break;}await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert(blockedPid,'Aktif e-belge sorgusu gerçek DB kilidinde beklemedi');
      const active=await queue('read',id);assert.equal(active.state,'active');assert.equal(active.attemptsStarted,1);assert.equal(active.attempts,0);assert.equal(active.stalledCounter,0);assert(active.lockTtl>100000&&active.lockTtl<=120000);
      signalAt=Date.now();await docker(['kill',forced?'--signal=KILL':'--signal=TERM',w]);
      if(forced){
        for(let i=0;i<50&&(await state(w)).Running;i++)await new Promise(resolve=>setTimeout(resolve,50));await killed(w);
      }else{assert.equal((await state(w)).Running,true);assert.equal(await sql(database,`SELECT count(*) FROM pg_stat_activity WHERE pid=${blockedPid} AND ${blocker}=ANY(pg_blocking_pids(pid))`),'1');}
      afterSignal=await queue('read',id);assert.equal(afterSignal.state,'active');assert.equal(afterSignal.attempts,0);assert(afterSignal.lockTtl>0);
    }finally{release();await holding;}
    if(!forced){
      await terminal(id,false);
      for(let i=0;i<100&&(await state(w)).Running;i++)await new Promise(resolve=>setTimeout(resolve,100));
      await stopped(w);
    }
    return {jobId:id,sinyal:forced?'SIGKILL':'SIGTERM',exitCode:(await state(w)).ExitCode,oom:(await state(w)).OOMKilled,dbBekleyenPid:blockedPid,kalanKilitMs:afterSignal.lockTtl,ms:Date.now()-signalAt};
  }
  for(const [label,w] of [['eski',worker],['guncel',current]]){
    const id='f04-'+nonce+'-ebelge-aktif-term-'+label;
    await check(label+'_aktif_ebelge_durum_sorgusu_sigterm_ile_tamamlanir',async()=>{
      if(!(await state(w)).Running){await docker(['start',w]);await readyWorker(w);}
      const other=w===worker?current:worker;await stopped(other);
      const detail=await interrupt(w,id,false);jobs.push([id,false]);assert.equal(await snapshot(),before);return detail;
    });
  }
  // İki graceful kontrol sonunda her iki süreç kapalıdır. Önce eski kaynak açılır.
  await docker(['start',worker]);await readyWorker(worker);
  for(const [direction,source,target] of [['eski-guncel',worker,current],['guncel-eski',current,worker]]){
    const id='f04-'+nonce+'-ebelge-aktif-kill-'+direction;
    await check(direction+'_aktif_ebelge_gonderimi_sigkill_ile_kesilir',async()=>{
      assert.equal((await state(source)).Running,true);assert.equal((await state(target)).Running,false);
      const detail=await interrupt(source,id,true);assert.equal(await snapshot(),before);return detail;
    });
    await check(direction+'_ebelge_stalled_is_dogal_kilit_sonrasi_dead_lettera_ulasir',async()=>{
      await killed(source);const began=Date.now();await docker(['start',target]);await readyWorker(target);
      const first=await queue('read',id);assert.equal(first.state,'active');assert.equal(first.attemptsStarted,1);assert(first.lockTtl>0);
      const deadline=Date.now()+240000;let r,lastLog=Date.now();
      while(Date.now()<deadline){
        r=await queue('read',id);if(r.state==='failed'&&r.dead)break;
        assert.notEqual(r.state,'completed','Gönderim yerel hata yerine tamamlandı');assert.equal((await state(target)).Running,true);await killed(source);
        if(Date.now()-lastLog>=30000){console.log(direction+': e-belge doğal stalled kurtarma bekleniyor; kalan kilit '+r.lockTtl+' ms');lastLog=Date.now();}
        await new Promise(resolve=>setTimeout(resolve,5000));
      }
      assert.equal(r.state,'failed');r=await terminal(id,true);jobs.push([id,true]);assert.equal(await snapshot(),before);
      const detail={yon:direction,jobId:id,beklemeMs:Date.now()-began,attemptsStarted:r.attemptsStarted,attemptsMade:r.attempts,stalledCounter:r.stalledCounter,deadLetterId:r.dead.id};recoveries.push(detail);return detail;
    });
  }
  await check('aktif_ebelge_kurtarma_sonrasi_restart_sonuclari_ve_db_kayitlarini_korur',async()=>{
    const stable=await Promise.all(jobs.map(([id,forced])=>terminal(id,forced)));
    await docker(['restart','--time','15',worker]);await readyWorker(worker);await killed(current);
    assert.deepEqual(await Promise.all(jobs.map(([id,forced])=>terminal(id,forced))),stable);assert.equal(await snapshot(),before);
    return {isAdedi:jobs.length,deadLetterAdedi:2,faturaVeEbelgeOzeti:sha(before)};
  });
  return {durum:'gecti',isAdedi:jobs.length,saglayiciKullanildi:false,kilitSuresiDegistirildi:false,dogrudanRedisKilitMudahalesi:false,kurtarmalar:recoveries,faturaVeEbelgeOzeti:sha(before),betikSha256:sha(await readFile(import.meta.filename))};
}
