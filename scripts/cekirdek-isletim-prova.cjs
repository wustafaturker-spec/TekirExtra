const {spawn}=require('node:child_process');const {createRequire}=require('node:module');const {resolve,relative,join}=require('node:path');const fs=require('node:fs/promises');const {createHash,randomBytes,randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
assert(process.argv[2], 'Kullanım: node scripts/cekirdek-isletim-prova.cjs <aday>');
const root=resolve(__dirname,'..'),candidate=resolve(process.argv[2]),nonce=randomBytes(8).toString('hex'),network='tekir-f02-runtime-'+nonce,database='f02_runtime_'+nonce,password=randomBytes(24).toString('hex'),loginPassword=randomBytes(20).toString('hex'),jwt=randomBytes(32).toString('hex');
const names=[],report={surum:1,baslangic:new Date().toISOString(),durum:'basladi',gercekSirketDegisikligi:false,internalAg:true,kontroller:[],temizlik:false};let db,token,networkCreated=false,output,manifest;
const sha=v=>createHash('sha256').update(v).digest('hex');const sanitize=s=>{for(const x of [password,loginPassword,jwt,token].filter(Boolean))s=s.replaceAll(x,'[redacted]');return s.replace(/(?:postgres(?:ql)?|redis):\/\/[^\s]+/g,'[connection]');};
function run(cmd,args,input,options={}){return new Promise((ok,fail)=>{const p=spawn(cmd,args,{cwd:options.cwd||resolve(root,'apps/api'),env:{...process.env,DATABASE_URL:process.env.F02_RUNTIME_MIGRATE_URL,DATABASE_URL_MIGRATE:process.env.F02_RUNTIME_MIGRATE_URL},stdio:['pipe','pipe','pipe'],timeout:options.timeout||180000});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',fail);p.on('close',c=>c===0?ok(out.trim()):fail(new Error(cmd+' exit '+c+': '+sanitize(err+out).slice(-2000))));p.stdin.end(input);});}
const docker=args=>run('docker',args);
async function start(role,args){const name='tekir-f02-runtime-'+role+'-'+nonce;await docker(['run','--pull=never','-d','--name',name,...args]);names.push(name);return name;}
async function http(container,path,options={},port=3001){const code="const f=require('node:fs');const x=JSON.parse(f.readFileSync(0,'utf8'));fetch(x.url,{...x.options,signal:AbortSignal.timeout(8000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(e=>{console.error(e.message);process.exitCode=1;});";const r=JSON.parse(await run('docker',['exec','-i',container,'node','-e',code],JSON.stringify({url:'http://127.0.0.1:'+port+path,options}),{timeout:15000}));return {status:r.status,json:()=>JSON.parse(r.body)};}
async function check(ad,fn){const t=Date.now();const detail=await fn();report.kontroller.push({ad,durum:'gecti',ms:Date.now()-t,...detail});console.log(ad+': geçti');}
const date=n=>new Date(new Date(Date.now()+n*86400000).toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'})+'T00:00:00Z'),day=n=>date(n).toISOString().slice(0,10);
async function verifyFiles(){const found={};async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,e.name),key=relative(output,p);if(e.isDirectory())await walk(p);else if(e.isSymbolicLink()){assert(!relative(output,await fs.realpath(p)).startsWith('..'));found[key]=sha('symlink\0'+await fs.readlink(p));}else if(e.isFile()){assert(!e.name.startsWith('.env'));found[key]=sha(await fs.readFile(p));}}}await walk(output);const actual=Object.fromEntries(Object.entries(found).sort((a,b)=>a[0].localeCompare(b[0])));assert.equal(sha(JSON.stringify(actual)),manifest.dosyaOzeti);assert.deepEqual(actual,manifest.files);}
async function main(){
  assert.equal(process.env.DATABASE_URL,undefined);assert.equal(process.env.DATABASE_URL_MIGRATE,undefined);
  const {adayiDogrula}=await import(resolve(root,'scripts/f02-aday-dogrula.mjs'));
  report.aday=await adayiDogrula(candidate,{kaynak:false});
  const pointer=JSON.parse(await fs.readFile(resolve(candidate,'runtime-son-aday.json'),'utf8'));assert(/^api-worker-runtime-[a-zA-Z0-9-]+$/.test(pointer.name));output=resolve(candidate,pointer.name);manifest=JSON.parse(await fs.readFile(resolve(candidate,pointer.manifest),'utf8'));assert.equal(manifest.durum,'paketlendi');report.runtime={name:pointer.name,dosyaOzeti:manifest.dosyaOzeti,aday:manifest.aday};report.betikSha256=sha(await fs.readFile(__filename));
  await check('paket_dosya_ve_baglanti_butunlugu',async()=>{await verifyFiles();return {files:manifest.fileCount,links:manifest.symlinkCount};});
  const nodeImage='sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55';report.nodeTabanImaji=nodeImage;report.eskiUygulamaCalistirilmadi=true;
  const mount=['--mount','type=bind,source='+output+',target=/runtime,readonly'];
  const depsProbe="const f=require('node:fs'),p=require('node:path'),r=require('node:module').createRequire('/runtime/apps/api/package.json');const names=Object.keys(require('/runtime/apps/api/package.json').dependencies);for(const name of names){if(!f.realpathSync(r.resolve(name)).startsWith('/runtime/'))throw Error('Paket dışı: '+name);r(name);}r('argon2').hash('yalnız-runtime-fixture').then(async h=>{if(!await r('argon2').verify(h,'yalnız-runtime-fixture'))throw Error('Argon2');console.log(JSON.stringify({node:process.version,dependencies:names.length,prisma:r('@prisma/client').Prisma.prismaVersion.client}));});";
  await check('node22_paket_ici_bagimlilik_ve_native_argon2',async()=>{const result=JSON.parse(await docker(['run','--pull=never','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,size=128m','-w','/runtime',...mount,'-e','NODE_PATH=','--entrypoint','node',nodeImage,'-e',depsProbe]));assert(result.node.startsWith('v22.'));return result;});
  await docker(['network','create','--internal',network]);networkCreated=true;
  const pg=await start('pg',['--network','bridge','--memory=512m','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-p','127.0.0.1::5432','-e','POSTGRES_USER=tekir','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB='+database,'postgres:16-alpine']);await docker(['network','connect','--alias','pg',network,pg]);
  const redis=await start('redis',['--network',network,'--network-alias','redis','--memory=96m','redis:7-alpine','redis-server','--save','','--appendonly','no']);
  await start('minio',['--network',network,'--network-alias','minio','--memory=256m','--tmpfs','/data:rw,size=128m','-e','MINIO_ROOT_USER=prova','-e','MINIO_ROOT_PASSWORD='+password,'minio/minio:latest','server','/data']);
  for(let i=0;;i++){try{await docker(['exec',pg,'pg_isready','-h','127.0.0.1','-U','tekir','-d',database]);break;}catch(e){if(i>100)throw e;await new Promise(r=>setTimeout(r,300));}}
  await run('docker',['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','tekir','-d',database],`CREATE ROLE tekir_app LOGIN PASSWORD '${password}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${password}'; ALTER DATABASE ${database} SET tekir.f02_runtime_nonce='${nonce}';`);
  const port=(await docker(['port',pg,'5432/tcp'])).split(':').at(-1).trim();assert(/^\d+$/.test(port)&&!['5432','5433'].includes(port));process.env.F02_RUNTIME_MIGRATE_URL='postgresql://tekir:'+password+'@127.0.0.1:'+port+'/'+database;await run('pnpm',['exec','prisma','migrate','deploy','--schema',resolve(output,'apps/api/prisma/schema.prisma')]);
  const req=createRequire(resolve(output,'apps/api/package.json'));req('reflect-metadata');const load=p=>req(resolve(output,'apps/api/dist',p+'.js'));const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami');db=new PrismaService({datasourceUrl:'postgresql://tekir_app:'+password+'@127.0.0.1:'+port+'/'+database+'?connection_limit=4'});const guard=(await db.$queryRawUnsafe("SELECT current_database() AS db,current_setting('tekir.f02_runtime_nonce',true) AS marker,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"))[0];assert.deepEqual(guard,{db:database,marker:nonce,rolsuper:false,rolbypassrls:false});
  const f={tenantId:randomUUID(),userId:randomUUID(),cariId:randomUUID(),faturaId:randomUUID()},loginEmail=f.userId+'@test.invalid',passwordHash=await req('argon2').hash(loginPassword),as=fn=>baglamlaCalistir({...f,rol:'yonetici'},fn),tx=fn=>as(()=>db.tenantIslem(f.tenantId,fn,{timeout:30000}));
  const invoice=(id=f.faturaId)=>({id,tenantId:f.tenantId,cariId:f.cariId,tip:'satis',durum:'kesin',tarih:date(-10),vadeTarihi:date(3),dovizCinsi:'TRY',kur:'1',toplamBrut:'2000',toplamMatrah:'2000',genelToplam:'2000',toplamSatirIskontosu:'0',genelIskontoToplam:'0',toplamKdv:'0',toplamTevkifat:'0',toplamNetKdv:'0'});
  await tx(async t=>{await t.tenant.create({data:{id:f.tenantId,vkn:f.tenantId,unvan:'İzole yeni runtime provası'}});await t.user.create({data:{id:f.userId,tenantId:f.tenantId,eposta:loginEmail,adSoyad:'Fixture',parolaHash:passwordHash,rol:'yonetici',epostaDogrulandi:true}});await t.cariHesap.create({data:{id:f.cariId,tenantId:f.tenantId,kod:'C',unvan:'Fixture cari',tip:'musteri'}});await t.fatura.create({data:invoice()});await t.modulAyar.create({data:{tenantId:f.tenantId,modul:'tahsilat_operasyonu',ayarlar:{surum:1,mod:'pilot'}}});});await db.authKimlik.create({data:{eposta:loginEmail,userId:f.userId,tenantId:f.tenantId}});
  const env=['-e','NODE_ENV=production','-e','NODE_PATH=','-e','DATABASE_URL=postgresql://tekir_app:'+password+'@pg:5432/'+database,'-e','DATABASE_URL_MIGRATE=postgresql://tekir:'+password+'@pg:5432/'+database,'-e','REDIS_URL=redis://redis:6379','-e','JWT_SECRET='+jwt,'-e','PLATFORM_JWT_SECRET='+randomBytes(32).toString('hex'),'-e','BAGLANTI_SIFRELEME_ANAHTARI='+randomBytes(32).toString('hex'),'-e','S3_ENDPOINT=http://minio:9000','-e','S3_ERISIM_ANAHTARI=prova','-e','S3_GIZLI_ANAHTAR='+password,'-e','S3_KOVA=f02-runtime-'+nonce,'-e','SMTP_HOST=127.0.0.1','-e','SMTP_PORT=9'];
  const args=['--init','--restart','on-failure:3','--network',network,'--memory=512m','--read-only','--tmpfs','/tmp:rw,size=128m','-w','/runtime',...mount,...env,'--entrypoint','node'];
  const api=await start('api',[...args.slice(0,-2),'-e','TEKIR_WORKER=0',...args.slice(-2),nodeImage,'/runtime/apps/api/dist/main.js']);
  let ready=false;for(let i=0;i<100;i++){try{if((await http(api,'/health')).status===200){ready=true;break;}}catch{}if(await docker(['inspect','--format','{{.State.Running}}',api])!=='true')break;await new Promise(r=>setTimeout(r,400));}
  await check('api_cold_start_ve_tum_bagimliliklar_ready',async()=>{assert(ready,'API başlamadı');const r=await http(api,'/health/ready');assert.equal(r.status,200);const b=r.json();assert.equal(b.durum,'ready');assert.equal(b.bagimliliklar.veritabani,'ok');assert.equal(b.bagimliliklar.redis,'ok');assert.equal(b.bagimliliklar.depo,'ok');return {hazirlik:b};});
  await check('gercek_parola_ile_http_giris',async()=>{const r=await http(api,'/api/v1/auth/giris',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eposta:loginEmail,parola:loginPassword})});assert.equal(r.status,201);token=r.json().accessToken;assert(token);});
  const request=(path,body,method='GET')=>http(api,'/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  await check('kimlik_cari_ve_fatura_okuma',async()=>{const ben=await request('/auth/ben');assert.equal(ben.status,200);assert.equal(ben.json().tenantId,f.tenantId);for(const [path,id] of [['/cari/'+f.cariId,f.cariId],['/fatura/'+f.faturaId,f.faturaId]]){const r=await request(path);assert.equal(r.status,200);assert.equal(r.json().id,id);}});
  let followup;
  await check('f02_http_takip_ve_gorusme',async()=>{const r=await request('/cari/tahsilat-takipleri',{cariId:f.cariId,sorumluUserId:f.userId,konu:'Runtime fixture takibi',neden:'itiraz',sonrakiIslemTarihi:day(7),sonrakiIslem:'Gerçek iletişim yok',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,201);followup=r.json();const n=await request('/cari/tahsilat-takipleri/'+followup.id+'/gorusmeler',{beklenenSurum:followup.surum,kanal:'not',gorusmeTarihi:day(0),not:'Yalnız izole runtime görüşmesi',istekAnahtari:randomUUID()},'POST');assert.equal(n.status,201);});
  await check('f02_http_odeme_sozu_ve_kaynak_okuma',async()=>{const r=await request('/cari/odeme-sozleri',{cariId:f.cariId,faturaId:f.faturaId,dovizCinsi:'TRY',tutar:'1000.00',sozTarihi:day(7),aciklama:'İzole runtime ödeme sözü',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,201);const list=await request('/cari/odeme-sozleri?cariId='+f.cariId);assert.equal(list.status,200);const b=list.json();assert.equal(b.sozler.length,1);assert.equal(b.sozler[0].gerceklesme.kalan,'1000.00');});
  await check('f02_http_nakit_cift_sayim_yok',async()=>{const r=await request('/nakit-akisi?ufuk=30');assert.equal(r.status,200);const b=r.json(),rows=b.kalemler.filter(p=>p.kaynakId===f.faturaId);assert.equal(rows.reduce((n,p)=>n+p.dovizTutar,0),2000);assert.equal(rows.find(p=>p.odemeSozu).dovizTutar,1000);});
  await tx(async t=>{const i=await t.fatura.create({data:invoice(randomUUID())});await t.odemeSozu.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:i.id,dovizCinsi:'TRY',tutar:'500',sozTarihi:date(-1),verildigiZaman:date(-4),olusturanUserId:f.userId,aciklama:'Yalnız izole worker fixture',istekAnahtari:randomUUID(),girdiOzeti:'a'.repeat(64)}});});
  const setting=await request('/ayarlar/tahsilat_otomasyonu',{acik:true,sorumluUserId:f.userId,uygulamaIciBildirim:true},'PUT');assert.equal(setting.status,200);
  const worker=await start('worker',[...args,nodeImage,'/runtime/apps/api/dist/main.worker.js']);
  await check('worker_cold_start_ve_geciken_soz_baglama',async()=>{let linked=false;for(let i=0;i<100;i++){const n=await tx(t=>t.tahsilatSozBaglantisi.count());if(n===1){linked=true;break;}if(await docker(['inspect','--format','{{.State.Running}}',worker])!=='true')break;await new Promise(r=>setTimeout(r,400));}assert(linked,'Worker sözü bağlamadı');const h=await http(worker,'/health',{},9464);assert.equal(h.status,200);assert.equal(h.json().worker,'ready');const records=await tx(async t=>({takip:await t.tahsilatTakibi.count(),bag:await t.tahsilatSozBaglantisi.findMany(),bildirim:await t.bildirim.findMany({where:{kaynakTur:'tahsilat_takibi'}})}));assert.equal(records.takip,1);assert.equal(records.bag[0].takipId,followup.id);assert.equal(records.bildirim.length,1);});
  await check('http_bildirim_baglanti_ve_gorusme_korunur_eposta_kapali',async()=>{const r=await request('/bildirimler?limit=100&kapsam=bana');assert.equal(r.status,200);assert(r.json().kayitlar.some(k=>k.bildirim.kaynakTur==='tahsilat_takibi'&&k.bildirim.hedefYol==='/panel/cari/tahsilat?takip='+followup.id));const d=await request('/cari/tahsilat-takipleri/'+followup.id);assert.equal(d.status,200);assert.equal(d.json().gorusmeler.length,1);const deliveries=await tx(t=>t.bildirimTeslimati.findMany({where:{bildirim:{kaynakTur:'tahsilat_takibi'}}}));assert.equal(deliveries.length,1);assert.equal(deliveries[0].epostaDurumu,'kapali');});
  await check('salt_okunur_kapatma_ve_403_http_yazma_engeli',async()=>{const s=await request('/ayarlar/tahsilat_operasyonu',{surum:1,mod:'salt_okunur'},'PUT');assert.equal(s.status,200);const r=await request('/cari/odeme-sozleri',{cariId:f.cariId,faturaId:f.faturaId,dovizCinsi:'TRY',tutar:'1.00',sozTarihi:day(7),aciklama:'İzole engel denemesi',istekAnahtari:randomUUID()},'POST');assert.equal(r.status,403);});
  const snapshot=()=>tx(async t=>{
    const models=['odemeSozu','tahsilatTakibi','tahsilatGorusmesi','tahsilatSozBaglantisi','bildirim','bildirimTeslimati','fatura','cariHareket','kasaBankaHareket','faturaKapama'];
    const hashes={};for(const model of models)hashes[model]=sha(JSON.stringify(await t[model].findMany({orderBy:{id:'asc'}})));
    hashes.isAudit=sha(JSON.stringify(await t.auditLog.findMany({where:{varlik:{in:['odeme_sozu','tahsilat_takibi']}},orderBy:{id:'asc'}})));
    return hashes;
  });
  const baseline=await snapshot();
  async function waitReady(container,port=3001){
    for(let i=0;i<100;i++){
      try{const r=await http(container,port===3001?'/health/ready':'/health',{},port);if(r.status===200)return;}catch{}
      await new Promise(r=>setTimeout(r,400));
    }
    throw Error('Servis hazır olmadı: '+container);
  }
  await check('kapali_mod_okuma_yazma_engeli_ve_kayitlar_korunur',async()=>{
    assert.equal((await request('/ayarlar/tahsilat_operasyonu',{surum:1,mod:'kapali'},'PUT')).status,200);
    assert.equal((await request('/cari/tahsilat-takipleri/'+followup.id)).status,403);
    assert.equal((await request('/cari/odeme-sozleri?cariId='+f.cariId)).status,403);
    assert.equal((await request('/cari/tahsilat-takipleri/'+followup.id+'/gorusmeler',{beklenenSurum:2,kanal:'not',gorusmeTarihi:day(0),not:'Kapalı mod engel kontrolü',istekAnahtari:randomUUID()},'POST')).status,403);
    const notifications=await request('/bildirimler?limit=100&kapsam=bana');assert.equal(notifications.status,200);
    assert(!notifications.json().kayitlar.some(k=>k.bildirim.kaynakTur==='tahsilat_takibi'));
    await docker(['restart','--time','3',worker]);await waitReady(worker,9464);
    assert.deepEqual(await snapshot(),baseline);return {ozetler:baseline};
  });
  await check('yeniden_acma_gecmis_bildirim_ve_worker_tekilligi',async()=>{
    assert.equal((await request('/ayarlar/tahsilat_operasyonu',{surum:1,mod:'pilot'},'PUT')).status,200);
    await docker(['restart','--time','3',worker]);await waitReady(worker,9464);
    const detail=await request('/cari/tahsilat-takipleri/'+followup.id);assert.equal(detail.status,200);assert.equal(detail.json().gorusmeler.length,1);
    const notifications=await request('/bildirimler?limit=100&kapsam=bana');assert.equal(notifications.status,200);
    assert(notifications.json().kayitlar.some(k=>k.bildirim.kaynakTur==='tahsilat_takibi'));
    assert.deepEqual(await snapshot(),baseline);
  });
  for(const [container,port] of [[api,3001],[worker,9464]]){
    await check((port===3001?'api':'worker')+'_surec_cokmesi_otomatik_yeniden_baslama',async()=>{
      const count=Number(await docker(['inspect','--format','{{.RestartCount}}',container]));
      const started=Date.now();
      await docker(['exec',container,'node','-e',"const fs=require('node:fs');const pid=Number(fs.readFileSync('/proc/1/task/1/children','utf8').trim().split(' ')[0]);if(!(pid>1)||!fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('/runtime/apps/api/dist/main'))throw Error('Prova uygulama PID doğrulanamadı');process.kill(pid,'SIGKILL')"]).catch(()=>{});
      let restarted=false;
      for(let i=0;i<100;i++){
        if(Number(await docker(['inspect','--format','{{.RestartCount}}',container]))===count+1){restarted=true;break;}
        await new Promise(r=>setTimeout(r,300));
      }
      assert(restarted,'Docker restart policy süreci açmadı');await waitReady(container,port);
      assert.deepEqual(await snapshot(),baseline);
      return {restartPolicy:'on-failure:3',oncekiRestart:count,sonrakiRestart:count+1,hazirOlmaMs:Date.now()-started};
    });
  }
  await check('redis_kesintisi_ready_503_liveness_200_ve_toparlanma',async()=>{
    await docker(['stop','--time','2',redis]);
    const ready=await http(api,'/health/ready');assert.equal(ready.status,503);assert.equal(ready.json().durum,'not_ready');assert.notEqual(ready.json().bagimliliklar.redis,'ok');
    assert.equal((await http(api,'/health')).status,200);
    await docker(['start',redis]);await waitReady(api);
    assert.equal((await request('/cari/tahsilat-takipleri/'+followup.id)).status,200);
    assert.deepEqual(await snapshot(),baseline);
    return {kesintiReady:503,kesintiLiveness:200,toparlanmaReady:200};
  });
  await check('yerel_http_es_zamanli_okuma_olcumu',async()=>{
    const paths=['/auth/ben','/cari/'+f.cariId,'/fatura/'+f.faturaId,'/cari/tahsilat-takipleri/'+followup.id,'/cari/odeme-sozleri?cariId='+f.cariId,'/nakit-akisi?ufuk=30'];
    const code=`const fs=require('node:fs'),{performance}=require('node:perf_hooks');const input=JSON.parse(fs.readFileSync(0,'utf8'));(async()=>{
      const samples=[];let next=0;const started=performance.now();
      async function worker(){while(next<input.total){const i=next++,path=input.paths[i%input.paths.length],t=performance.now();try{const r=await fetch('http://127.0.0.1:3001/api/v1'+path,{headers:{Authorization:'Bearer '+input.token},signal:AbortSignal.timeout(15000)});await r.arrayBuffer();samples.push({path,status:r.status,ms:performance.now()-t});}catch{samples.push({path,status:0,ms:performance.now()-t});}}}
      await Promise.all(Array.from({length:input.concurrency},worker));console.log(JSON.stringify({samples,durationMs:performance.now()-started}));
    })().catch(e=>{console.error(e.message);process.exitCode=1;});`;
    const concurrency=4,total=120;
    const result=JSON.parse(await run('docker',['exec','-i',api,'node','-e',code],JSON.stringify({paths,total,concurrency,token})));
    assert.equal(result.samples.length,total);assert(result.samples.every(s=>s.status===200),'Yük koşumunda HTTP hatası');
    const metrics=rows=>{const times=rows.map(s=>s.ms).sort((a,b)=>a-b),q=p=>Number(times[Math.max(0,Math.ceil(times.length*p)-1)].toFixed(2));return {istek:rows.length,minMs:q(0),p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:q(1)};};
    assert.deepEqual(await snapshot(),baseline);
    const stats=JSON.parse(await docker(['stats','--no-stream','--format','{{json .}}',api]));
    return {uretimSlaKabulu:false,veriSeti:{tenant:1,cari:1,fatura:2,soz:2,takip:1,gorusme:1},closedLoop:true,concurrency,total,durationMs:Math.round(result.durationMs),requestsPerSecond:Number((total*1000/result.durationMs).toFixed(2)),toplam:metrics(result.samples),uclar:paths.map(path=>({path:path.replaceAll(f.cariId,':cariId').replaceAll(f.faturaId,':faturaId').replaceAll(followup.id,':takipId'),...metrics(result.samples.filter(s=>s.path===path))})),konteyner:{memoryLimit:'512m',cpuLimit:'yok',memoryUsage:stats.MemUsage,cpuPercent:stats.CPUPerc},basarisizIstek:0};
  });
  await verifyFiles();await adayiDogrula(candidate,{kaynak:false});report.durum='gecti';report.testAdedi=report.kontroller.length;
}
main().catch(e=>{report.durum='basarisiz';report.hata=sanitize(String(e.stack||e));process.exitCode=1;}).finally(async()=>{
  report.logs={};for(const name of names)if(name.includes('-api-')||name.includes('-worker-'))report.logs[name]=sanitize(await docker(['logs','--tail','8',name]).catch(e=>e.message)).slice(-2200);
  await db?.$disconnect();const errors=[];for(const name of [...names].reverse())try{await docker(['stop','--time','3',name]);await docker(['rm',name]);}catch(e){errors.push(sanitize(e.message));}if(networkCreated)try{await docker(['network','rm',network]);}catch(e){errors.push(sanitize(e.message));}report.temizlik=errors.length===0;report.temizlikHatalari=errors;if(!report.temizlik){report.durum='basarisiz';process.exitCode=1;}report.bitis=new Date().toISOString();await fs.writeFile(resolve(candidate,'cekirdek-isletim-prova.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
});
