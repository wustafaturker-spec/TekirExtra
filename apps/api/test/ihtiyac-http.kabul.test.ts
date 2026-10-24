import 'reflect-metadata';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {createServer,request as proxyRequest,type Server} from 'node:http';
import {Module} from '@nestjs/common';
import {NestFactory,Reflector} from '@nestjs/core';
import {JwtService} from '@nestjs/jwt';
import {chromium,type Browser} from 'playwright';
import * as argon2 from 'argon2';
import {beforeAll,afterAll,it,expect} from 'vitest';

const url=process.env.F01_YARIS_DB_URL,dist=process.env.F04_API_DIST,webRoot=process.env.F04_WEB_ROOT;
if(!url||!dist||!webRoot||!process.env.F01_YARIS_NONCE)throw Error('Yalnız --f04-http izole runner ve hazır API/web paketleriyle çalıştırın');
const parsed=new URL(url);
if(parsed.hostname!=='127.0.0.1'||!/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname)||parsed.username!=='tekir_app'||['5432','5433'].includes(parsed.port))throw Error('Geçici DB kapsamı geçersiz');
const req=createRequire(import.meta.url),load=(p:string)=>req(resolve(dist,p+'.js'));
load('ayar-tanimlari');
const {PrismaService}=load('core/prisma.service'),{bosTutucuylaCalistir,baglamlaCalistir}=load('core/istek-baglami');
const {AuthGuard}=load('auth/auth.guard'),{RollerGuard}=load('auth/roller.guard'),{AuthService}=load('auth/auth.service'),{GirisDenemeSayaci}=load('auth/giris-deneme-sayaci'),{AuthController}=load('auth/auth.controller');
const {IhtiyacController}=load('stok/ihtiyac.controller'),{IhtiyacService}=load('stok/ihtiyac.service'),{IhtiyacPlanService}=load('stok/ihtiyac-plan.service'),{IhtiyacUretimTalebiService}=load('stok/ihtiyac-uretim-talebi.service'),{SiparisGirisTarihiService}=load('stok/siparis-giris-tarihi.service');
const {StokController}=load('stok/stok.controller'),{StokService}=load('stok/stok.service'),{DepoController}=load('stok/depo.controller'),{DepoService}=load('stok/depo.service'),{SayimService}=load('stok/sayim.service'),{TransferService}=load('stok/transfer.service'),{AbonelikService}=load('tenant/abonelik.service'),{DonemKilidiService}=load('donem-kapatma/donem-kilidi.service');
const {AyarlarController}=load('core/ayarlar/ayarlar.controller');
const {SatinAlmaController}=load('satin-alma/satin-alma.controller'),{SatinAlmaService}=load('satin-alma/satin-alma.service'),{ButceService}=load('butce/butce.service'),{AyarlarService}=load('core/ayarlar/ayarlar.service');
const db=new PrismaService({datasourceUrl:url}),jwt=new JwtService({secret:randomBytes(32).toString('hex'),signOptions:{expiresIn:'10m'}});
const external=new Proxy({},{get:(_t,k)=>()=>{throw Error('Kapsam dışı servis çağrısı: '+String(k));}});
const ihtiyac=new IhtiyacService(db),depo=new DepoService(db);
const providers=[ [AyarlarService,new AyarlarService(db)],[SatinAlmaService,new SatinAlmaService(db,new AyarlarService(db),external,new ButceService(db),undefined,ihtiyac)],[PrismaService,db],[AuthService,new AuthService(db,jwt,GirisDenemeSayaci.bellekte())],[IhtiyacService,ihtiyac],[IhtiyacPlanService,new IhtiyacPlanService(db,ihtiyac)],[IhtiyacUretimTalebiService,new IhtiyacUretimTalebiService(db)],[SiparisGirisTarihiService,new SiparisGirisTarihiService(db)],[DepoService,depo],[StokService,new StokService(db,external,depo,new DonemKilidiService(db))],[AbonelikService,new AbonelikService(db)],[SayimService,Object.freeze({})],[TransferService,Object.freeze({})] ];
class TestModule{}
Module({controllers:[AyarlarController,SatinAlmaController,AuthController,IhtiyacController,StokController,DepoController],providers:providers.map(([provide,useValue])=>({provide,useValue}))})(TestModule);
let app:any,base:string,web:ChildProcess|undefined,proxy:Server|undefined,browser:Browser|undefined,webUrl:string;
const evidence=resolve(process.env.F04_HTTP_EVIDENCE??'../../.release-candidates/f04-http-20261022');
const ctx=(f:any,fn:()=>Promise<any>)=>baglamlaCalistir({...f,rol:'depo'},fn);
const tx=(f:any,fn:(t:any)=>Promise<any>)=>ctx(f,()=>db.tenantIslem(f.tenantId,fn));
const http=(path:string,token?:string,body?:unknown,method=body===undefined?'GET':'POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(path:string,token:string,body?:unknown,method?:string){const r=await http(path,token,body,method);const j=await r.json();expect(r.ok,JSON.stringify(j)).toBe(true);return j;}
beforeAll(async()=>{
 console.info('F04 HTTP başlangıç: DB rol denetimi');
 const [r]=await db.$queryRaw`SELECT current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 expect(r).toEqual({nonce:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
 console.info('F04 HTTP başlangıç: Nest modülü');
 app=await NestFactory.create(TestModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api/v1');app.use((_q:unknown,_s:unknown,next:()=>void)=>bosTutucuylaCalistir(next));app.useGlobalGuards(new AuthGuard(jwt,new Reflector()),new RollerGuard(new Reflector()));await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1';
 console.info('F04 HTTP başlangıç: API hazır, web açılıyor');
 await mkdir(evidence,{recursive:true});
 const socket=netServer();await new Promise<void>(ok=>socket.listen(0,'127.0.0.1',ok));const webPort=(socket.address() as {port:number}).port;await new Promise<void>(ok=>socket.close(()=>ok()));
 web=spawn(process.execPath,[resolve(webRoot,'server.js')],{cwd:webRoot,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(webPort),NODE_OPTIONS:'--max-old-space-size=768'},stdio:['ignore','pipe','pipe']});
 let output='';web.stdout!.on('data',d=>output+=d);web.stderr!.on('data',d=>output+=d);
 let nextUrl='';const webDeadline=Date.now()+120000;while(Date.now()<webDeadline){if(web.exitCode!==null)throw Error(output.slice(-1500));nextUrl=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';if(nextUrl){try{if((await fetch(nextUrl+'/giris',{signal:AbortSignal.timeout(2000)})).ok)break;}catch{}}await new Promise(r=>setTimeout(r,300));}
 expect(nextUrl).toMatch(/:\d+$/);
 proxy=createServer((q,s)=>{const target=new URL(q.url?.startsWith('/api/v1/')?base:nextUrl);const upstream=proxyRequest({hostname:'127.0.0.1',port:target.port,path:q.url,method:q.method,headers:q.headers},r=>{s.writeHead(r.statusCode??502,r.headers);r.pipe(s);});upstream.on('error',()=>{s.writeHead(502);s.end();});q.pipe(upstream);});
 await new Promise<void>(ok=>proxy!.listen(0,'127.0.0.1',ok));webUrl=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;
 console.info('F04 HTTP başlangıç: web hazır, Chromium açılıyor');
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
});
afterAll(async()=>{await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise<void>(ok=>proxy!.close(()=>ok()));}if(web&&web.exitCode===null){web.kill('SIGTERM');await new Promise<void>(ok=>{const timer=setTimeout(()=>{web?.kill('SIGKILL');ok();},10000);web!.once('exit',()=>{clearTimeout(timer);ok();});});}await app?.close();await db.$disconnect();});
async function fixture(rol='depo'){
 const tenantId=randomUUID(),eposta=tenantId+'@test.invalid',parola=randomBytes(16).toString('hex'),parolaHash=await argon2.hash(parola);
 const f=await db.$transaction(async(t:any)=>{
  await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:'F04 HTTP izole'}});
  await t.modulAyar.create({data:{tenantId,modul:'stok_ihtiyac_plani',ayarlar:{surum:1,mod:'pilot'}}});
  const user=await t.user.create({data:{tenantId,eposta,parolaHash,adSoyad:'HTTP Depo',rol,epostaDogrulandi:true}});await t.authKimlik.create({data:{tenantId,eposta,userId:user.id}});
  const stok=await t.stokKart.create({data:{tenantId,kod:'H1',ad:'HTTP hammadde',tip:'urun',anaBirim:'adet'}}),mamul=await t.stokKart.create({data:{tenantId,kod:'M1',ad:'Mamul',tip:'urun',anaBirim:'adet'}}),d=await t.depo.create({data:{tenantId,kod:'D1',ad:'Hammadde deposu'}});
  await t.stokDepoBakiye.create({data:{tenantId,stokId:stok.id,depoId:d.id,mevcutMiktar:'10',rezerveMiktar:'0',yoldakiMiktar:'0'}});
  const emir=await t.uretimEmri.create({data:{tenantId,no:'HTTP-UR1',stokId:mamul.id,hedefDepoId:d.id,planlananMiktar:'1',tarih:new Date(),durum:'malzeme_bekliyor'}}),kalem=await t.uretimEmriKalem.create({data:{tenantId,uretimEmriId:emir.id,malzemeStokId:stok.id,planlananMiktar:'3',sarfEdilenMiktar:'0'}});
  return {tenantId,userId:user.id,stokId:stok.id,depoId:d.id,kalemId:kalem.id};
 });
 const login=await json('/auth/giris','',{eposta,parola});return {...f,eposta,parola,token:login.accessToken};
}
const prefix='/stok/ihtiyac-plani';
it('gerçek JWT/controller HTTP: anonim, bozuk token, rol, UUID, tenant ve eski kaynak sınırları',async()=>{
 const f=await fixture(),g=await fixture(),path=prefix+'/uretim-talepleri/'+f.kalemId;
 for(const token of [undefined,'bozuk'])expect((await http(path,token)).status).toBe(401);
 expect((await http(path,jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'satis'}))).status).toBe(403);
 expect((await http(path,g.token)).status).toBe(404);expect((await http(prefix+'/planlar/bozuk',f.token)).status).toBe(400);
 const k=await json(path,f.token),body={depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:k.kaynakOzeti,gerekce:'HTTP depo günü teyidi'};
 await json(path,f.token,body,'PUT');expect((await http(path,f.token,{...body,ihtiyacTarihi:'2098-12-29'},'PUT')).status).toBe(409);
 expect((await http(prefix+'/planlar?imlec='+randomUUID(),f.token)).status).toBe(409);
});
it('parolalı Chromium → açık üretim ataması → tarihli plan → gerçek DB kayıt/pay/audit → eski plan kontrolü',async()=>{
 const f=await fixture(),page=await browser!.newPage(),apiRequests:string[]=[],pageErrors:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/v1/'))apiRequests.push(r.url());});page.on('pageerror',e=>pageErrors.push(e.message));
 const before=await tx(f,async(t:any)=>JSON.stringify([await t.stokDepoBakiye.findMany(),await t.stokHareket.findMany(),await t.uretimEmriKalem.findMany({select:{id:true,planlananMiktar:true,sarfEdilenMiktar:true}}),await t.satinAlmaTalebi.findMany()]));
 await page.goto(webUrl+'/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(f.eposta);await page.getByLabel('Parola',{exact:true}).fill(f.parola);await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();await page.waitForURL('**/panel');
 await page.goto(webUrl+`/panel/stok/uretim-talepleri?kalemId=${f.kalemId}`);
 await expect.poll(()=>page.getByLabel('Hammadde deposu',{exact:true}).inputValue()).toBe('');await page.getByLabel('Hammadde deposu',{exact:true}).selectOption(f.depoId);await page.getByLabel('Malzeme ihtiyaç günü',{exact:true}).fill('2098-12-30');await page.getByLabel('Atama veya kaldırma gerekçesi',{exact:true}).fill('Tarayıcıdan gerçek kaynak teyidi');await page.getByRole('button',{name:'Depo ve günü ata',exact:true}).click();await page.getByText('Rezerv dışı üretim ihtiyacının deposu ve günü atandı.',{exact:true}).waitFor();
 const query=new URLSearchParams({stokId:f.stokId,depoId:f.depoId,miktar:'8',birim:'adet',ihtiyacTarihi:'2099-01-01',kaynak:'stok-ihtiyac',hesapTuru:'tarihli'});
 await page.goto(webUrl+'/panel/stok/ihtiyac?'+query);await expect.poll(()=>page.getByLabel('İhtiyaç miktarı',{exact:true}).inputValue()).toBe('8');await page.getByRole('button',{name:'İhtiyacı hesapla',exact:true}).click();await page.getByRole('button',{name:'Planı sakla',exact:true}).waitFor();
 const save=page.waitForResponse(r=>r.url()===webUrl+'/api/v1'+prefix+'/planlar'&&r.request().method()==='POST');await page.getByRole('button',{name:'Planı sakla',exact:true}).click();const saved=await save;expect(saved.status()).toBe(201);const result=await saved.json();
 await page.getByRole('link',{name:'Kayıtlı planı incele',exact:true}).click();await page.getByText('Planın kaynakları güncel hesapla aynı.',{exact:true}).waitFor();
 const historical=await json(prefix+'/planlar/'+result.id,f.token);expect(historical.snapshot.tarihli).toMatchObject({eksik:'1.000',ekTalep:'3.000'});expect(historical.karsilamaBaglari).toHaveLength(1);expect(historical.karsilamaBaglari[0].miktar).toBe('7');
 expect(await tx(f,(t:any)=>t.ihtiyacPlani.count())).toBe(1);expect(await tx(f,(t:any)=>t.auditLog.count({where:{varlikId:result.id}}))).toBe(1);
 await tx(f,(t:any)=>t.uretimEmriKalem.update({where:{id:f.kalemId},data:{planlananMiktar:'4'}}));await page.getByRole('button',{name:'Güncelliği tekrar kontrol et',exact:true}).click();await page.getByText(/Planın kaynakları veya ihtiyaç günü değişmiş/).waitFor();const stale=await json(prefix+'/planlar/'+result.id,f.token);expect(stale.guncel).toBe(false);expect(stale.snapshot).toEqual(historical.snapshot);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'gercek-api-plan-mobil.png'),fullPage:true});
 // Testin bilinçli kaynak değişikliğini geri al; asıl iş verileri sabit kalmalı.
 await tx(f,(t:any)=>t.uretimEmriKalem.update({where:{id:f.kalemId},data:{planlananMiktar:'3'}}));expect(await tx(f,async(t:any)=>JSON.stringify([await t.stokDepoBakiye.findMany(),await t.stokHareket.findMany(),await t.uretimEmriKalem.findMany({select:{id:true,planlananMiktar:true,sarfEdilenMiktar:true}}),await t.satinAlmaTalebi.findMany()]))).toBe(before);
 expect(apiRequests.every(u=>u.startsWith(webUrl+'/api/v1/'))).toBe(true);expect(pageErrors).toEqual([]);
 await writeFile(resolve(evidence,'tarayici-ozeti.json'),JSON.stringify({durum:'gecti',gercekParolaGirisi:true,apiYanitiTaklidi:false,tokenEnjeksiyonu:false,tarayiciApiIstekSayisi:apiRequests.length,gercekSirketPilotu:false},null,2));await page.close();
});

it('parolalı Chromium: güncel plan → satın alma taslağı → tek atomik bağ; HTTP tekrarı ikinci talep yazmaz',async()=>{
 const f=await fixture();const kaynak=await json(prefix+'/uretim-talepleri/'+f.kalemId,f.token);
 await json(prefix+'/uretim-talepleri/'+f.kalemId,f.token,{depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:kaynak.kaynakOzeti,gerekce:'Satın alma planı depo teyidi'},'PUT');
 const girdi={stokId:f.stokId,depoId:f.depoId,miktar:'8',birim:'adet',ihtiyacTarihi:'2099-01-01'};
 const onizleme=await json(prefix+'/tarihli-onizle?'+new URLSearchParams(girdi),f.token),plan=await json(prefix+'/planlar',f.token,{istekAnahtari:randomUUID(),beklenenSonucKaniti:onizleme.sonucKaniti,girdi});
 const page=await browser!.newPage();await page.goto(webUrl+'/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(f.eposta);await page.getByLabel('Parola',{exact:true}).fill(f.parola);await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();await page.waitForURL('**/panel');
 await page.goto(webUrl+'/panel/stok/ihtiyac-planlari?plan='+plan.id);await page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true}).click();await expect.poll(()=>page.getByLabel('1. kalem miktarı',{exact:true}).inputValue()).toBe('1.000');await page.getByLabel('Bütçe kalemi',{exact:true}).selectOption('mal_alis');await page.getByLabel('1. kalem tahmini birim fiyatı',{exact:true}).fill('10');
 const saved=page.waitForResponse(r=>r.url()===webUrl+'/api/v1/satin-alma/talepler'&&r.request().method()==='POST');await page.getByRole('button',{name:'Taslak kaydet',exact:true}).click();const response=await saved.catch(async e=>{await page.screenshot({path:resolve(evidence,'plan-talep-hata.png'),fullPage:true});await writeFile(resolve(evidence,'plan-talep-hata.txt'),await page.locator('body').innerText());throw e;});expect(response.status()).toBe(201);const request=response.request().postDataJSON(),talep=await response.json();expect(request.ihtiyacPlaniId).toBe(plan.id);expect(await json('/satin-alma/talepler',f.token,request)).toEqual(talep);
 await page.goto(webUrl+'/panel/stok/ihtiyac-planlari?plan='+plan.id);await page.getByRole('link',{name:'Bağlı talebi incele',exact:true}).waitFor();expect(await page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true}).count()).toBe(0);
 expect(await tx(f,(t:any)=>t.satinAlmaTalebi.count())).toBe(1);expect(await tx(f,(t:any)=>t.ihtiyacSatinAlmaBagi.count())).toBe(1);expect(await tx(f,(t:any)=>t.satinAlmaTalebi.findFirst())).toMatchObject({durum:'taslak'});
 await page.screenshot({path:resolve(evidence,'gercek-api-plan-talep.png'),fullPage:true});await page.close();
});

it('pilot HTTP raporu salt okunur ve tenant kapsamlıdır; veri hazırlığı gerçek alan kabulü sayılmaz',async()=>{
 const f=await fixture(),foreign=await fixture(),path=prefix+'/pilot-onizle',ornek={etiket:'Atama bekleyen üretim',girdi:{stokId:f.stokId,depoId:f.depoId,miktar:'8',birim:'adet',ihtiyacTarihi:'2099-01-01'}};
 expect((await http(path,undefined,{ornekler:[ornek]})).status).toBe(401);
 expect((await http(path,jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'satis'}),{ornekler:[ornek]})).status).toBe(403);
 const snapshot=()=>tx(f,async(t:any)=>JSON.stringify([await t.stokDepoBakiye.findMany(),await t.ihtiyacPlani.findMany(),await t.satinAlmaTalebi.findMany(),await t.auditLog.findMany()])),once=await snapshot();
 const response=await http(path,f.token,{ornekler:[ornek,{etiket:'Diğer şirket',girdi:{...ornek.girdi,stokId:foreign.stokId}}]});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const rapor=await response.json();
 expect(rapor).toMatchObject({dbSaltOkunur:true,kapasiteAyrildi:false,operasyonPilotuTamamlandi:false,raporKapsami:'secili_ornekler',ozet:{hesaplanan:1,veriBelirsiz:1,reddedilen:1}});expect(rapor.ornekler[0]).toMatchObject({hesap:{mevcut:'10.000',kullanilabilir:'10.000',talep:'8.000'}});expect(rapor.ornekler[1]).toMatchObject({durum:'reddedildi',httpDurumu:404});expect(await snapshot()).toBe(once);
 await writeFile(resolve(evidence,'pilot-onizleme.json'),JSON.stringify(rapor,null,2));
});
it('gerçek ayar ekranı: yönetici salt okunur/kapat modunu uygular; sunucu yazmayı ve tekrarları engeller',async()=>{
 const f=await fixture('yonetici'),depoKullanicisi=await fixture(),path='/ayarlar/stok_ihtiyac_plani';
 expect((await http(path,depoKullanicisi.token,{surum:1,mod:'kapali'},'PUT')).status).toBe(403);
 await tx(f,(t:any)=>t.modulAyar.deleteMany({where:{modul:'stok_ihtiyac_plani'}}));expect(await json(path,f.token)).toMatchObject({surum:1,mod:'kapali'});expect(await tx(f,(t:any)=>t.modulAyar.count({where:{modul:'stok_ihtiyac_plani'}}))).toBe(0);await json(path,f.token,{surum:1,mod:'pilot'},'PUT');
 const kaynak=await json(prefix+'/uretim-talepleri/'+f.kalemId,f.token),atama={depoId:f.depoId,ihtiyacTarihi:'2098-12-30',aktif:true,beklenenSurum:0,beklenenKaynakOzeti:kaynak.kaynakOzeti,gerekce:'Mod kabulü hammadde günü'};
 await json(prefix+'/uretim-talepleri/'+f.kalemId,f.token,atama,'PUT');
 const girdi={stokId:f.stokId,depoId:f.depoId,miktar:'8',birim:'adet',ihtiyacTarihi:'2099-01-01'},onizleme=await json(prefix+'/tarihli-onizle?'+new URLSearchParams(girdi),f.token),istek={istekAnahtari:randomUUID(),beklenenSonucKaniti:onizleme.sonucKaniti,girdi};const plan=await json(prefix+'/planlar',f.token,istek);
 const page=await browser!.newPage();await page.goto(webUrl+'/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(f.eposta);await page.getByLabel('Parola',{exact:true}).fill(f.parola);await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();await page.waitForURL('**/panel');
 await page.goto(webUrl+'/panel/ayarlar/moduller');const card=page.locator('.card').filter({has:page.getByRole('heading',{name:/Tarihli Stok İhtiyacı/})});await card.getByLabel('Kullanım modu',{exact:true}).selectOption('salt_okunur');const saved=page.waitForResponse(r=>r.url()===webUrl+'/api/v1'+path&&r.request().method()==='PUT');await card.getByRole('button',{name:'Kaydet',exact:true}).click();expect((await saved).status()).toBe(200);
 const tarihsel=await json(prefix+'/planlar/'+plan.id,f.token);expect(tarihsel).toMatchObject({guncel:true,erisim:{mod:'salt_okunur',yazabilir:false}});
 await page.goto(webUrl+'/panel/stok/ihtiyac-planlari?plan='+plan.id);await page.getByText('Şirket modu salt okunur; bu plandan yeni taslak oluşturulamaz.',{exact:true}).waitFor();expect(await page.getByRole('link',{name:'Bu plandan satın alma taslağı hazırla',exact:true}).count()).toBe(0);
 expect((await http(prefix+'/planlar',f.token,istek)).status).toBe(403);expect((await http(prefix+'/uretim-talepleri/'+f.kalemId,f.token,atama,'PUT')).status).toBe(403);
 expect((await http('/satin-alma/talepler',f.token,{ihtiyacPlaniId:plan.id,ihtiyacTarihi:'2099-01-01',gerekce:'Salt okunur taslak denemesi',butceAnahtari:'mal_alis',kalemler:[{stokId:f.stokId,miktar:'1.000',tahminiBirimFiyat:'10'}]})).status).toBe(403);
 await json(path,f.token,{surum:1,mod:'kapali'},'PUT');expect((await http(prefix+'/planlar/'+plan.id,f.token)).status).toBe(403);expect((await http(prefix+'/onizle?'+new URLSearchParams(girdi),f.token)).status).toBe(200);
 expect(await tx(f,(t:any)=>t.auditLog.count({where:{islem:'ihtiyac_modu_guncellendi'}}))).toBe(3);expect(await tx(f,(t:any)=>t.ihtiyacPlani.count())).toBe(1);expect(await tx(f,(t:any)=>t.satinAlmaTalebi.count())).toBe(0);
 await json(path,f.token,{surum:1,mod:'pilot'},'PUT');expect((await json(prefix+'/planlar/'+plan.id,f.token)).snapshot).toEqual(tarihsel.snapshot);
 await writeFile(resolve(evidence,'mod-kabul-ozeti.json'),JSON.stringify({durum:'gecti',restoreFixture:{tenantId:f.tenantId,userId:f.userId,planId:plan.id},gercekParolaGirisi:true,ayarEkranindanSaltOkunur:true,yoneticiDisiModDegistiremez:true,kapaliykenAnlikHesapAcik:true,yeniF04YazmalariVeTekrarlariEngellendi:true,snapshotKorundu:true,gercekSirketPilotu:false},null,2));await page.close();
});
