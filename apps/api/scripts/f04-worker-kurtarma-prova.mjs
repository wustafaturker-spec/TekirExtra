import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Yalnız nonce/rol doğrulanmış geçici restore DB. Canlı adres veya serbest paket yolu almaz.
export async function kesilenIsiKurtar({db,tx,f,sql,database,nonce,docker,queue,worker,current,readyWorker,check}){
  assert(/^f01_yaris_[a-f0-9]{16}$/.test(database));assert(/^[a-f0-9]{16}$/.test(nonce));
  const [guard]=await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.deepEqual(guard,{db:database,nonce,rolsuper:false,rolbypassrls:false});
  assert(/^[a-f0-9-]{36}$/.test(f.tenantId));
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const payroll=()=>tx(t=>t.personelBordro.findMany({include:{kalemler:{orderBy:{id:'asc'}}},orderBy:{id:'asc'}}));
  const fingerprint=rows=>sha(JSON.stringify(rows));
  async function state(w){return JSON.parse(await docker(['inspect','--format','{{json .State}}',w]));}
  async function killed(w){const s=await state(w);assert.equal(s.Running,false);assert.equal(s.OOMKilled,false);assert.equal(s.ExitCode,137);return {exitCode:s.ExitCode,oom:s.OOMKilled};}
  function preserved(before,after){
    const ids=new Set(before.map(b=>b.id));assert.equal(fingerprint(after.filter(b=>ids.has(b.id))),fingerprint(before));
    assert.equal(new Set(after.map(b=>b.personelId+'-'+b.donemYil+'-'+b.donemAy)).size,after.length);
    assert(after.every(b=>b.kalemler.length>0));
  }
  const report={durum:'basladi',kilitSuresiDegistirildi:false,redisAnahtarinaYazildi:false,yonler:[]};
  for(const [direction,source,target] of [['eski-yeni',worker,current],['yeni-eski',current,worker]]){
    const jobId='f04-'+nonce+'-kurtarma-'+direction;
    let before,partial,blockPerson,blockerPid,blockedPid,atKill;
    const functionName='f04_kurtarma_'+nonce,lockKey=parseInt(nonce.slice(0,7),16);
    await check(direction+'_kismi_commit_sonrasi_sigkill',async()=>{
      assert.equal((await state(source)).Running,true);assert.equal((await state(target)).Running,false);
      before=await payroll();assert(before.length>0);
      const persons=[];
      for(const suffix of ['A','B'])persons.push(await tx(t=>t.personel.create({data:{tenantId:f.tenantId,personelNo:'F04-KURTAR-'+direction+'-'+suffix,ad:'İzole',soyad:'Kurtarma',girisTarihi:new Date('2026-01-01'),netMaas:'30000',istihdamDonemleri:{create:{tenantId:f.tenantId,baslangicTarihi:new Date('2026-01-01')}},ucretler:{create:{tenantId:f.tenantId,yururlukTarihi:new Date('2026-01-01'),tip:'net',tutar:'30000'}}}})));
      blockPerson=persons[1];assert(/^[a-f0-9-]{36}$/.test(blockPerson.id));
      // Yalnız ikinci yeni personelin INSERT'i bekler. İlk personel ayrı transaction'da commit olur.
      await sql(database,`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${f.tenantId}'::uuid AND NEW.personel_id='${blockPerson.id}'::uuid THEN PERFORM pg_advisory_xact_lock(17304,${lockKey}); END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON public.personel_bordro FOR EACH ROW EXECUTE FUNCTION public.${functionName}();`);
      let release,announce;
      const gate=new Promise(resolve=>{release=resolve;}),acquired=new Promise(resolve=>{announce=resolve;});
      const holding=db.$transaction(async t=>{
        await t.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(17304,${lockKey})`);
        const [{pid}]=await t.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announce(pid);await gate;
      },{timeout:30000});
      const networks=JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Networks}}',source]));
      const addresses=Object.values(networks).map(n=>n.IPAddress);assert.equal(addresses.length,1);assert(/^\d+\.\d+\.\d+\.\d+$/.test(addresses[0]));
      try{
        blockerPid=await Promise.race([acquired,holding.then(()=>{throw Error('Kilit alınmadan transaction bitti');})]);
        assert(Number.isInteger(blockerPid));await queue('add',jobId);
        const deadline=Date.now()+2500;
        while(Date.now()<deadline){
          const pid=await sql(database,`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename='tekir_app' AND client_addr='${addresses[0]}'::inet AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND wait_event='advisory' ORDER BY pid LIMIT 1`);
          if(/^\d+$/.test(pid)){blockedPid=Number(pid);break;}await new Promise(resolve=>setTimeout(resolve,50));
        }
        assert(blockedPid,'İkinci personel INSERT kilidine ulaşmadı');
        const active=await queue('read',jobId);assert.equal(active.state,'active');assert.equal(active.attemptsStarted,1);assert.equal(active.attempts,0);assert.equal(active.stalledCounter,0);assert(active.lockTtl>240000&&active.lockTtl<=300000);
        partial=await payroll();assert.equal(partial.length,before.length+1);preserved(before,partial);assert(partial.some(b=>b.personelId===persons[0].id));assert(!partial.some(b=>b.personelId===blockPerson.id));
        await docker(['kill','--signal=KILL',source]);
        for(let i=0;i<50&&(await state(source)).Running;i++)await new Promise(resolve=>setTimeout(resolve,50));
        await killed(source);atKill=await queue('read',jobId);assert.equal(atKill.state,'active');assert.equal(atKill.attempts,0);assert(atKill.lockTtl>0);
      }finally{
        release();
        try{await holding;}finally{await sql(database,`DROP TRIGGER ${functionName} ON public.personel_bordro; DROP FUNCTION public.${functionName}();`);}
      }
      // SIGKILL ikinci INSERT transaction'ını rollback etmiş olmalı.
      assert.equal(fingerprint(await payroll()),fingerprint(partial));
      return {jobId,exitCode:137,oom:false,ilkYeniBordroCommit:true,ikinciBordroRollback:true,oncekiBordroAdedi:before.length,kismiBordroAdedi:partial.length,kalanKilitMs:atKill.lockTtl,attemptsStarted:atKill.attemptsStarted};
    });
    await check(direction+'_dogal_kilit_sonrasi_stalled_is_kurtarilir',async()=>{
      await killed(source);const began=Date.now();await docker(['start',target]);await readyWorker(target);
      const first=await queue('read',jobId);assert.equal(first.state,'active');assert.equal(first.attemptsStarted,1);assert(first.lockTtl>0);
      const deadline=Date.now()+420000;let completed,lastLog=Date.now();
      while(Date.now()<deadline){
        completed=await queue('read',jobId);if(completed.state==='completed')break;
        assert.notEqual(completed.state,'failed',completed.failedReason);
        assert.equal((await state(target)).Running,true);await killed(source);
        if(Date.now()-lastLog>=30000){console.log(direction+': doğal stalled kurtarma bekleniyor; kalan kilit '+completed.lockTtl+' ms');lastLog=Date.now();}
        await new Promise(resolve=>setTimeout(resolve,5000));
      }
      assert.equal(completed.state,'completed');assert.equal(completed.attemptsStarted,2);assert.equal(completed.attempts,1);assert.equal(completed.stalledCounter,1);assert.equal(completed.lockTtl,-2);
      const total=before.length+2;assert.deepEqual(completed.result,{olusturulanSayi:1,toplamAktifPersonel:total,mevcutSayi:total-1,hatalar:[]});
      const after=await payroll();assert.equal(after.length,total);preserved(partial,after);assert(after.some(b=>b.personelId===blockPerson.id));
      const detail={yon:direction,jobId,beklemeMs:Date.now()-began,attemptsStarted:completed.attemptsStarted,attemptsMade:completed.attempts,stalledCounter:completed.stalledCounter,bordroAdedi:after.length,bordroOzeti:fingerprint(after)};
      report.yonler.push(detail);return detail;
    });
  }
  await check('kurtarma_sonrasi_restart_tamamlanan_is_ve_bordrolari_tekrarlamaz',async()=>{
    const before=await payroll();await docker(['restart','--time','15',worker]);await readyWorker(worker);await killed(current);
    for(const direction of ['eski-yeni','yeni-eski']){
      const job=await queue('read','f04-'+nonce+'-kurtarma-'+direction);assert.equal(job.state,'completed');assert.equal(job.attemptsStarted,2);assert.equal(job.attempts,1);assert.equal(job.stalledCounter,1);
    }
    assert.equal(fingerprint(await payroll()),fingerprint(before));
    // Her iki test trigger'ı/function'ı kaldırılmış olmalı.
    assert.equal(await sql(database,`SELECT count(*) FROM pg_proc WHERE proname='${'f04_kurtarma_'+nonce}'`),'0');
    return {bordroAdedi:before.length,bordroOzeti:fingerprint(before),geciciTetikleyiciKaldirildi:true};
  });
  report.durum='gecti';report.betikSha256=sha(await readFile(import.meta.filename));return report;
}
