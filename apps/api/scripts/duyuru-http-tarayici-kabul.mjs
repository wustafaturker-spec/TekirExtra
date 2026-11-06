import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Yalnız test kapları, rastgele sırlar ve geçici kullanıcılar. Pilot ortam dosyaları okunmaz.
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
if(process.argv.includes('--help')){console.log('node apps/api/scripts/duyuru-http-tarayici-kabul.mjs <api-runtime> <web-paketi>');process.exit(0);}
const [runtimeArg,webArg]=process.argv.slice(2);
assert.ok(runtimeArg && webArg,'API runtime ve web paketi yolları açıkça verilmelidir.');
const runtime=resolve(root,runtimeArg),webRoot=resolve(root,webArg),web=join(webRoot,'apps/web');
assert.ok(runtime.startsWith(join(root,'.release-candidates')+'/') && webRoot.startsWith(join(root,'.release-candidates')+'/'),'Yalnız yayın adayı paketleri kabul edilir.');
const nonce=randomBytes(5).toString('hex'), prefix='tekir-duyuru-http-'+nonce;
const report=join(root,'.release-candidates/platform-duyuru-design-20261106','http-kabul-'+nonce);
const secret=()=>randomBytes(32).toString('hex');
const password=secret(), jwt=secret(), platformJwt=secret(), session=secret(), key=secret(), storage=secret(), userPassword=secret();
const secrets=[password,jwt,platformJwt,session,key,storage,userPassword];
const redact=s=>secrets.reduce((v,x)=>v.replaceAll(x,'[gizli]'),String(s));
const require=createRequire(join(root,'apps/api/package.json'));
const {PrismaClient}=require('@prisma/client'), argon2=require('argon2'), {generateSync,generateSecret}=require('otplib');
const {chromium,expect}=createRequire(join(root,'apps/web/package.json'))('@playwright/test');
const {sifrele}=require(join(runtime,'apps/api/dist/core/kripto.js'));
const envArgs=e=>Object.entries(e).flatMap(([k,v])=>['-e',`${k}=${v}`]);
function run(cmd,args,options={}) {return new Promise((ok,fail)=>{const p=spawn(cmd,args,{cwd:join(root,'apps/api'),env:options.env??process.env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',fail);p.on('close',c=>c===0?ok(out.trim()):fail(new Error(redact(`${cmd} ${args[0]} (${c}): ${out.slice(-6000)}`))));p.stdin.end(options.input);});}
const docker=(...args)=>run('docker',args);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,ms=120000){const end=Date.now()+ms;for(;;){try{if(await fn())return;}catch{}if(Date.now()>end)throw new Error('Hazırlık zaman aşımı');await sleep(500);}}
async function listen(server){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});return server.address().port;}
const owned=[], state={startedAt:new Date().toISOString(),apiRuntime:runtimeArg,webPackage:webArg,mockedResponses:false,pilotModified:false,scenarios:[]};
let network=false,db,browser,webProcess,proxy,stage='hazırlık',webLog='';
await mkdir(report,{recursive:true});
try {
 stage='geçici veritabanı';
 // Tarayıcı host üzerindedir: port yalnız 127.0.0.1'e açılır; bütün servisler ayrı test ağında kalır.
 await docker('network','create','--label','tekirextra.test=duyuru-http',prefix);network=true;
 const start=async(name,args)=>{await docker('run','--rm','-d','--pull=never','--name',name,'--label','tekirextra.test=duyuru-http',...args);owned.push(name);};
 await start(prefix+'-pg',['--memory=768m','--tmpfs','/var/lib/postgresql/data:rw,size=384m','-p','127.0.0.1::5432',...envArgs({POSTGRES_USER:'tekir',POSTGRES_PASSWORD:password,POSTGRES_DB:'duyuru_kabul',POSTGRES_INITDB_ARGS:'--no-sync'}),'postgres:16-alpine','postgres','-c','fsync=off','-c','synchronous_commit=off']);
 await docker('network','connect','--alias','pg',prefix,prefix+'-pg');
 await waitFor(async()=>{await docker('exec',prefix+'-pg','pg_isready','-h','127.0.0.1','-U','tekir','-d','duyuru_kabul');return true;},300000);
 await run('docker',['exec','-i',prefix+'-pg','psql','-v','ON_ERROR_STOP=1','-U','tekir','-d','duyuru_kabul'],{input:`CREATE ROLE tekir_app LOGIN PASSWORD '${password}'; CREATE ROLE tekir_platform LOGIN PASSWORD '${password}';`});
 const portOf=async(name,port)=>{const p=(await docker('port',name,port)).split(':').at(-1).trim();assert.match(p,/^\d+$/);return p;};
 const pgPort=await portOf(prefix+'-pg','5432/tcp');
 const pgUrl=(role,host='127.0.0.1',port=pgPort)=>`postgresql://${role}:${password}@${host}:${port}/duyuru_kabul?connection_limit=4&connect_timeout=30`;
 await run('pnpm',['exec','prisma','migrate','deploy'],{env:{...process.env,DATABASE_URL:pgUrl('tekir'),DATABASE_URL_MIGRATE:pgUrl('tekir'),DATABASE_URL_PLATFORM:pgUrl('tekir_platform')}});
 console.log('İzole PostgreSQL: tüm migrationlar uygulandı.');
 stage='izole hesaplar';db=new PrismaClient({datasourceUrl:pgUrl('tekir')});
 const hash=await argon2.hash(userPassword), totpSecret=generateSecret();
 secrets.push(totpSecret);
 process.env.BAGLANTI_SIFRELEME_ANAHTARI=key;
 const platformEmail=`platform-${nonce}@kabul.invalid`, targetEmail=`hedef-${nonce}@kabul.invalid`, otherEmail=`diger-${nonce}@kabul.invalid`;
 await db.platformKullanici.create({data:{eposta:platformEmail,adSoyad:'HTTP kabul yöneticisi',parolaHash:hash,totpSecretSifreli:sifrele(totpSecret),rol:'yonetici'}});
 const tenantIds=[];
 for(const [i,email] of [targetEmail,otherEmail].entries()){
  const id=randomUUID();tenantIds.push(id);
  await db.tenant.create({data:{id,unvan:i?'Kabul hariç firma':'Kabul hedef firma',vkn:i?'1111111111':'2222222222'}});
  await db.tenantAbonelik.create({data:{tenantId:id,planKodu:'v1',durum:'aktif',donemSonu:new Date(Date.now()+86400000*30)}});
  const u=await db.user.create({data:{tenantId:id,eposta:email,adSoyad:'HTTP kabul alıcısı',rol:'yonetici',parolaHash:hash,epostaDogrulandi:true}});
  await db.authKimlik.create({data:{tenantId:id,userId:u.id,eposta:email}});
 }
 stage='izole servisler';
 await start(prefix+'-redis',['--memory=128m','--network',prefix,'--network-alias','redis','redis:7-alpine']);
 await start(prefix+'-minio',['--memory=384m','--network',prefix,'--network-alias','minio',...envArgs({MINIO_ROOT_USER:'duyuru-test',MINIO_ROOT_PASSWORD:storage}),'minio/minio:latest','server','/data']);
 await start(prefix+'-api',['--memory=1500m','--network',prefix,'-p','127.0.0.1::3001','-v',runtime+':/runtime:ro','-w','/runtime','--entrypoint','node',...envArgs({NODE_ENV:'production',PORT:'3001',HOST:'0.0.0.0',TEKIR_WORKER:'0',DATABASE_URL:pgUrl('tekir_app','pg',5432),DATABASE_URL_MIGRATE:pgUrl('tekir','pg',5432),DATABASE_URL_PLATFORM:pgUrl('tekir_platform','pg',5432),REDIS_URL:'redis://redis:6379',JWT_SECRET:jwt,PLATFORM_JWT_SECRET:platformJwt,OTURUM_ISARETI_SECRET:session,BAGLANTI_SIFRELEME_ANAHTARI:key,APP_URL:'http://localhost',SMTP_HOST:'smtp.invalid',SMTP_PORT:'25',MAIL_FROM:'kabul@ornek.invalid',S3_ENDPOINT:'http://minio:9000',S3_ERISIM_ANAHTARI:'duyuru-test',S3_GIZLI_ANAHTAR:storage,S3_KOVA:'duyuru-kabul',S3_BOLGE:'us-east-1'}),'tekirextra-pilot-runtime:20261101','apps/api/dist/main.js']);
 const apiPort=await portOf(prefix+'-api','3001/tcp');
 const apiUrl='http://127.0.0.1:'+apiPort;
 stage='API hazırlığı';console.log('İzole API hazırlığı bekleniyor.');
 await waitFor(async()=>{const r=await fetch(apiUrl+'/health/ready',{signal:AbortSignal.timeout(3000)});return r.ok;},300000);
 // Üretim web paketi ayrı portta çalışır; proxy yalnız gerçek API/web'e yönlendirir.
 const reservation=createServer();const webPort=await listen(reservation);await new Promise(r=>reservation.close(r));
 webProcess=spawn(process.execPath,[join(web,'server.js')],{cwd:web,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(webPort),HOSTNAME:'127.0.0.1',OTURUM_ISARETI_SECRET:session},stdio:['ignore','pipe','pipe']});
 stage='web hazırlığı';console.log('İzole API hazır; üretim web paketi başlatılıyor.');
 webProcess.stdout.on('data',d=>webLog+=d);webProcess.stderr.on('data',d=>webLog+=d);
 await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${webPort}/giris`,{signal:AbortSignal.timeout(2000)});return r.ok;});
 proxy=createServer((req,res)=>{const isApi=req.url.startsWith('/api/v1/');const upstream=httpRequest({hostname:'127.0.0.1',port:isApi?apiPort:webPort,path:req.url,method:req.method,headers:req.headers},u=>{res.writeHead(u.statusCode,u.headers);u.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end('Test upstream unavailable');});req.pipe(upstream);});
 const proxyPort=await listen(proxy),base=`http://localhost:${proxyPort}`;
 browser=await chromium.launch({channel:'chromium'});
 async function newContext(width){const c=await browser.newContext({viewport:{width,height:900}});await c.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));return c;}
 console.log('Üretim API/web hazır; gerçek giriş ve duyuru akışları başlıyor.');
 async function loginTenant(page,email){await page.goto(base+'/giris?donus=/panel/duyurular');await page.getByLabel('E-posta Adresi',{exact:true}).fill(email);await page.getByLabel('Parola',{exact:true}).fill(userPassword);await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();await expect(page).toHaveURL(url=>url.pathname==='/panel/duyurular',{timeout:30000});}
 // localhost üzerindeki Secure çerezleri Chromium yönetir; APIRequestContext farklı kurallar uygular.
 async function browserJson(page,path){return page.evaluate(async p=>{const r=await fetch(p,{credentials:'same-origin'});return {status:r.status,data:await r.json()};},path);}
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9S0AAAAASUVORK5CYII=','base64');
 for(const width of [1440,390]){
  stage=`${width}px platform girişi`;
  const context=await newContext(width),page=await context.newPage();
  await page.goto(base+'/platform/giris');await page.getByLabel('E-posta',{exact:true}).fill(platformEmail);await page.getByLabel('Parola',{exact:true}).fill(userPassword);await page.getByLabel('Doğrulama kodu',{exact:true}).fill(generateSync({secret:totpSecret}));await page.getByRole('button',{name:'Giriş yap',exact:true}).click();await expect(page).toHaveURL(/\/platform$/,{timeout:30000});
  stage=`${width}px taslak ve görsel`;
  await page.goto(base+'/platform/duyurular/yeni');const title=`Gerçek HTTP duyurusu ${width}`;
  await page.getByLabel('Duyuru başlığı',{exact:true}).fill(title);await page.getByLabel('Biçimlendirilmiş içerik',{exact:true}).fill('**Gerçek API kabulü**\nGörsel ve hedefleme doğrulanıyor.');
  await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();await expect(page).toHaveURL(/\/platform\/duyurular\/[0-9a-f-]{36}$/,{timeout:30000});const id=new URL(page.url()).pathname.split('/').at(-1);
  const uploaded=page.waitForResponse(r=>r.url().endsWith(`/duyurular/${id}/gorsel`)&&r.request().method()==='POST');
  await page.locator('#duyuru-gorsel').setInputFiles({name:'kabul.png',mimeType:'image/png',buffer:png});const uploadResponse=await uploaded;assert.ok(uploadResponse.ok(),`Görsel yükleme: ${uploadResponse.status()} ${await uploadResponse.text()}`);
  await page.getByLabel('Buton metni (isteğe bağlı)',{exact:true}).fill('Duyuruyu incele');await page.getByLabel('Buton bağlantısı (HTTPS veya /panel yolu)',{exact:true}).fill('/panel/duyurular');await page.getByRole('button',{name:'Taslağı kaydet',exact:true}).click();await expect(page.getByText('Tüm değişiklikler kaydedildi',{exact:true})).toBeVisible();
  stage=`${width}px hedefleme ve yayın`;
  await page.getByRole('navigation',{name:'Duyuru bölümleri'}).getByRole('link',{name:'Hedef kitle',exact:true}).click();await page.getByLabel('Firma kapsamı',{exact:true}).selectOption('secili');await page.getByLabel('Dahil et: Kabul hedef firma').check();
  for(const name of ['Panel üst bandı','Popup','Modül içinde kart'])await page.getByRole('checkbox',{name,exact:true}).check();
  await page.getByRole('checkbox',{name:'Genel panel',exact:true}).check();await page.getByLabel('Erteleme süresi',{exact:true}).selectOption('60');await page.getByLabel('Bitiş (Türkiye)',{exact:true}).fill(new Date(Date.now()+27*3600000).toISOString().slice(0,16));
  await page.getByRole('button',{name:'Hedefi ve yayını önizle',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('1 firma · 1 kullanıcı');await expect(dialog.locator('img')).toBeVisible();await expect.poll(()=>dialog.locator('img').evaluate(e=>e.naturalWidth)).toBe(1);
  await page.getByRole('button',{name:'Duyuru yayınını onayla',exact:true}).click();await expect(page.getByText('Yayında',{exact:true})).toBeVisible();
  stage=`${width}px firma okuma ve erteleme`;
  const tc=await newContext(width),tp=await tc.newPage();await loginTenant(tp,targetEmail);
  await expect(tp.getByRole('dialog',{name:title,exact:true})).toBeVisible({timeout:30000});await tp.getByRole('button',{name:'1 saat ertele',exact:true}).click();await expect(tp.getByRole('dialog')).toHaveCount(0);
  await tp.reload();await expect(tp.locator(`#duyuru-${id}`)).toBeVisible();await expect(tp.getByRole('dialog')).toHaveCount(0);
  let article=tp.locator(`#duyuru-${id}`);await expect(article.locator('img')).toBeVisible();await article.getByRole('button',{name:'Okudum',exact:true}).click();await expect(article.getByText('Okundu',{exact:true})).toBeVisible();await tp.reload();article=tp.locator(`#duyuru-${id}`);await expect(article.getByText('Okundu',{exact:true})).toBeVisible();
  await Promise.all([tp.waitForNavigation(),article.getByRole('button',{name:'Duyuruyu incele',exact:true}).click()]);await tp.goto(base+'/panel');await expect(tp.locator(`#duyuru-modul-${id}`)).toBeVisible();await expect(tp.locator(`#duyuru-bant-${id}`)).toBeVisible();
  stage=`${width}px hedef dışı erişim ve rapor`;
  const oc=await newContext(width),op=await oc.newPage();await loginTenant(op,otherEmail);assert.equal((await browserJson(op,`/api/v1/duyurular/${id}`)).status,404);await expect(op.getByRole('heading',{name:title,exact:true})).toHaveCount(0);
  const reportResponse=await browserJson(page,`/api/v1/platform/duyurular/${id}/rapor`);assert.equal(reportResponse.status,200);const metrics=reportResponse.data;for(const [k,v] of Object.entries({firma:1,kullanici:1,gosterim:1,okudum:1,tiklama:1,popupErtelendi:1}))assert.equal(metrics[k],v,k);
  stage=`${width}px durdurma`;
  await page.getByRole('button',{name:'Yayını durdur',exact:true}).click();await page.getByRole('button',{name:'Durdurmayı onayla',exact:true}).click();await expect(page.getByText('Durduruldu',{exact:true})).toBeVisible();await tp.goto(base+'/panel/duyurular');await expect(tp.locator(`#duyuru-${id}`)).toHaveCount(0);assert.equal((await browserJson(tp,`/api/v1/duyurular/${id}`)).status,404);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(report,`platform-${width}.png`),fullPage:true});
  state.scenarios.push({width,platformTotpLogin:true,tenantLogin:true,imageUpload:true,imageServed:true,targetExclusion:true,popupSnooze:true,readPersists:true,moduleCard:true,upperBanner:true,uniqueMetrics:true,stopRevokes:true});
  await context.close();await tc.close();await oc.close();console.log(`${width}px gerçek HTTP/tarayıcı akışı geçti.`);
 }
 state.status='passed';
} catch(e){state.status='failed';state.stage=stage;state.error=redact(e.stack??e);console.error(redact(`Kabul başarısız (${stage}): ${e.message}`));process.exitCode=1;
 await writeFile(join(report,'web-log.txt'),redact(webLog));
 try{await writeFile(join(report,'api-log.txt'),redact(await docker('logs','--tail','100',prefix+'-api')));}catch{}
 try{await writeFile(join(report,'pg-log.txt'),redact(await docker('logs','--tail','30',prefix+'-pg')));}catch{}
} finally {
 if(browser)await browser.close().catch(()=>{});if(proxy)await new Promise(r=>proxy.close(r));if(webProcess)webProcess.kill('SIGTERM');if(db)await db.$disconnect().catch(()=>{});
 state.cleanupErrors=[];for(const name of owned.reverse())try{await docker('rm','-f',name);}catch(e){state.cleanupErrors.push(redact(e.message));}
 if(network)try{await docker('network','rm',prefix);}catch(e){state.cleanupErrors.push(redact(e.message));}
 state.cleaned=state.cleanupErrors.length===0;state.completedAt=new Date().toISOString();await writeFile(join(report,'sonuc.json'),JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify({status:state.status,stage:state.stage,scenarios:state.scenarios.length,cleaned:state.cleaned,report:relativePath(report)}));if(!state.cleaned)process.exitCode=1;
}
function relativePath(p){return p.slice(root.length+1);}
