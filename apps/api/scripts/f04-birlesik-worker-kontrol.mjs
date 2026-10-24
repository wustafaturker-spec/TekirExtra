import assert from 'node:assert/strict';

// Servis provasının kendi internal ağı/paketleri; serbest servis veya bağlantı adresi almaz.
export function birlesikWorkerKontrolu({nonce,start,docker,http,network,image,mountOld,overlay,env,queue,control,assertNewApiReady}){
  assert(/^[a-f0-9]{16}$/.test(nonce));
  const names={},timeline=[];
  const log=(event,detail={})=>{timeline.push({event,zaman:new Date().toISOString(),...detail});console.log('Birleşik devir: '+event);};
  async function state(version){return names[version]?JSON.parse(await docker(['inspect','--format','{{json .State}}',names[version]])):null;}
  async function stopped(version){const s=await state(version);if(!s)return;assert.equal(s.Running,false);assert.equal(s.OOMKilled,false);assert([0,143].includes(s.ExitCode),'Worker normal kapanmadı: '+s.ExitCode);}
  async function healthy(version){const s=await state(version);assert(s?.Running,version+' worker çalışmıyor');assert.equal(s.OOMKilled,false);const r=await http(names[version],'/health',9464);assert.equal(r.status,200);assert.equal(JSON.parse(r.body).worker,'ready');}
  async function pausedAndDrained(){
    let s;const deadline=Date.now()+30000;
    do{s=await queue('read');assert.equal(s.paused,true);if(s.active===0)return s;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
    throw Error('Pause sonrasında aktif e-belge işleri bitmedi');
  }
  async function maintenance(){const r=await control('durum');const s=JSON.parse(r.body);assert.equal(s.mode,'bakim');assert.equal(s.active,0);return s;}
  async function launch(version){
    await pausedAndDrained();await stopped(version==='yeni'?'eski':'yeni');
    if(names[version])await docker(['start',names[version]]);
    else names[version]=await start(version+'-worker',['--network',network,'--memory=512m','--read-only','--tmpfs','/tmp:rw,size=128m','-w','/runtime',...mountOld,...(version==='yeni'?overlay:[]),...env,'--entrypoint','node',image,'/runtime/apps/api/dist/main.worker.js']);
    const deadline=Date.now()+40000;let ready=false;
    while(Date.now()<deadline){try{await healthy(version);ready=true;break;}catch{if(!(await state(version))?.Running)break;await new Promise(r=>setTimeout(r,200));}}
    assert(ready,version+' worker hazır olmadı');log(version+'_worker_hazir');
  }
  async function stop(version){
    await maintenance();await pausedAndDrained();await healthy(version);
    await docker(['stop','--time','15',names[version]]);await stopped(version);log(version+'_worker_normal_durdu',{exitCode:(await state(version)).ExitCode});
  }
  async function assertResumeAllowed(){
    const r=await control('durum');assert.equal(JSON.parse(r.body).mode,'yeni','Resume yalnız güncel HTTP trafiğinde yapılabilir');
    const old=await state('eski');assert(!old?.Running,'Eski worker çalışırken e-belge resume reddedildi');await stopped('eski');await healthy('yeni');await assertNewApiReady();
  }
  return {timeline,launch,stop,healthy,pausedAndDrained,maintenance,assertResumeAllowed,
    async assertBothStopped(){await stopped('yeni');await stopped('eski');},
    async restartNew(){await healthy('yeni');await stopped('eski');await docker(['restart','--time','15',names.yeni]);const deadline=Date.now()+40000;let ready=false;while(Date.now()<deadline){try{await healthy('yeni');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready);log('yeni_worker_restart_hazir');},
    async personel(version,container,run,data){
      await healthy(version);const id='f04-'+nonce+'-birlesik-personel-'+version;
      const code="const {Queue}=require('bullmq');const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const q=new Queue('tekirextra-personel',{connection:{host:'redis',port:6379,maxRetriesPerRequest:1}});(async()=>{try{if(x.add)await q.add('bordro-tahakkuk',x.data,{jobId:x.id,attempts:1,removeOnComplete:false,removeOnFail:false});const j=await q.getJob(x.id);console.log(JSON.stringify({id:j.id,state:await j.getState(),attempts:j.attemptsMade,result:j.returnvalue}));}finally{await q.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});";
      const read=add=>run('docker',['exec','-i','-w','/runtime/apps/api',container,'node','-e',code],{input:JSON.stringify({id,add,data:{...data,rol:'yonetici',donemYil:2026,donemAy:10}})}).then(JSON.parse);
      await read(true);let r;for(let i=0;i<100;i++){r=await read(false);if(r.state==='completed')break;assert.notEqual(r.state,'failed');await new Promise(ok=>setTimeout(ok,100));}
      assert.equal(r.state,'completed');assert.equal(r.attempts,1);assert.deepEqual(r.result,{olusturulanSayi:0,toplamAktifPersonel:0,mevcutSayi:0,hatalar:[]});log(version+'_personel_isi_tamamlandi',{jobId:id});return r;
    }
  };
}
