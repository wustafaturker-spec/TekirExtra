import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as netServer } from "node:net";
import { createServer, request as proxyRequest, type Server } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { chromium, type Browser } from "playwright";
import * as argon2 from "argon2";
import { afterAll, beforeAll, expect, it } from "vitest";

const url=process.env.F01_YARIS_DB_URL,dist=process.env.F03_API_DIST;
if(!url || !dist || !process.env.F01_YARIS_NONCE)throw Error('Yalnız --f03-http geçici DB runner ile çalıştırın');
const parsed=new URL(url);
if(parsed.hostname!=='127.0.0.1' || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username!=='tekir_app' || ['5432','5433'].includes(parsed.port))throw Error('Geçici DB kapsamı doğrulanamadı');
const req=createRequire(import.meta.url),load=(p:string)=>req(resolve(dist,p+'.js'));
load('ayar-tanimlari');
const {PrismaService}=load('core/prisma.service'),{bosTutucuylaCalistir,baglamlaCalistir}=load('core/istek-baglami');
const {AuthGuard}=load('auth/auth.guard'),{RollerGuard}=load('auth/roller.guard'),{AuthService}=load('auth/auth.service'),{GirisDenemeSayaci}=load('auth/giris-deneme-sayaci'),{AuthController}=load('auth/auth.controller');
const {CrmBelgeService}=load('crm/crm-belge.service'),{CrmBelgeController}=load('crm/crm-belge.controller'),{CrmFirsatService}=load('crm/crm-firsat.service'),{CrmFirsatController}=load('crm/crm-firsat.controller');
const {BelgelerService}=load('belgeler/belgeler.service'),{BelgelerController}=load('belgeler/belgeler.controller'),{FaturaService}=load('fatura/fatura.service'),{FaturaController}=load('fatura/fatura.controller');
const {DonemKilidiService}=load('donem-kapatma/donem-kilidi.service'),{DepoService}=load('stok/depo.service'),{StokService}=load('stok/stok.service'),{BaglantilarService}=load('tenant/baglantilar.service'),{AbonelikService}=load('tenant/abonelik.service');
const db=new PrismaService({datasourceUrl:url}),jwt=new JwtService({secret:randomBytes(32).toString('hex'),signOptions:{expiresIn:'10m'}});
const external=new Proxy({}, {get:(_t,key)=>()=>{throw Error('Harici servis bu provada çağrılamaz: '+String(key));}});
const donem=new DonemKilidiService(db),depo=new DepoService(db),stok=new StokService(db,external,depo,donem),belgeler=new BelgelerService(db,external,depo,donem);
const services=[
 [AuthService,new AuthService(db,jwt,GirisDenemeSayaci.bellekte())], [CrmFirsatService,new CrmFirsatService(db)], [CrmBelgeService,new CrmBelgeService(db,belgeler)],
 [BelgelerService,belgeler], [AbonelikService,new AbonelikService(db)],
 [FaturaService,new FaturaService(db,stok,depo,external,external,belgeler,donem,new BaglantilarService(db),external,external)],
];
class TestModule{}
Module({controllers:[AuthController,CrmFirsatController,CrmBelgeController,BelgelerController,FaturaController],providers:services.map(([provide,useValue])=>({provide,useValue}))})(TestModule);
let app:any,base:string,browser:Browser|undefined,web:ChildProcess|undefined,proxy:Server|undefined;
const root=resolve(__dirname,'../../..'),artifacts=resolve(process.env.F03_ARTIFACT_DIR??resolve(root,'.release-candidates/f03-http-20261018'));
let webAdres: { webUrl: string; browserApi: string } | undefined;
beforeAll(async()=>{
 const [r]=await db.$queryRaw`SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS marker,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 expect(r).toEqual({db:parsed.pathname.slice(1),marker:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
 app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api/v1');
 app.use((_q:unknown,_s:unknown,next:()=>void)=>bosTutucuylaCalistir(next));
 app.useGlobalGuards(new AuthGuard(jwt,new Reflector()),new RollerGuard(new Reflector()));
 app.enableCors({origin:/^http:\/\/127\.0\.0\.1:\d+$/,credentials:true});
 await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1';
});
afterAll(async()=>{
 await browser?.close();
 if(proxy){proxy.closeAllConnections();await new Promise<void>(ok=>proxy!.close(()=>ok()));}
 if(web && web.exitCode===null){web.kill('SIGTERM');await new Promise<void>((ok,bad)=>{const timer=setTimeout(()=>{web?.kill('SIGKILL');bad(Error('İzole web kapanmadı'));},10000);web!.once('exit',()=>{clearTimeout(timer);ok();});});}
 await app?.close();await db.$disconnect();
});
const ctx=(f:any,fn:()=>Promise<any>)=>baglamlaCalistir({...f,rol:'yonetici'},fn);
const tx=(f:any,fn:(t:any)=>Promise<any>)=>ctx(f,()=>db.tenantIslem(f.tenantId,fn));
const http=(path:string,auth?:string,body?:unknown,method='GET')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(path:string,auth:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<any>{
 const r=await http(path,auth,body,method),j=await r.json();expect(r.status,JSON.stringify(j)).toBe(body===undefined?200:201);return j;
}
async function fixture(){
 const tenantId=randomUUID(),parola=randomBytes(16).toString('hex'),eposta=tenantId+'@test.invalid',parolaHash=await argon2.hash(parola);
 const f=await db.$transaction(async(t:any)=>{
  await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
  await t.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:'F03 izole HTTP'}});
  const u=await t.user.create({data:{tenantId,eposta,parolaHash,adSoyad:'F03 prova',rol:'yonetici',epostaDogrulandi:true}});
  await t.authKimlik.create({data:{tenantId,eposta,userId:u.id}});
  const c=await t.cariHesap.create({data:{tenantId,kod:'C1',unvan:'HTTP müşterisi',tip:'musteri'}});
  const s=await t.stokKart.create({data:{tenantId,kod:'H1',ad:'HTTP hizmeti',tip:'hizmet',anaBirim:'adet'}});
  await t.depo.create({data:{tenantId,kod:'D1',ad:'Prova deposu',varsayilan:true}});
  await t.modulAyar.create({data:{tenantId,modul:'crm_belge_baglari',ayarlar:{surum:1,mod:'pilot'}}});
  return {tenantId,userId:u.id,cariId:c.id,stokId:s.id};
 });
 const login=await json('/auth/giris','',{eposta,parola});return {...f,eposta,parola,auth:login.accessToken};
}
async function opportunity(f:any){return json('/crm/firsatlar',f.auth,{baslik:'HTTP satış fırsatı',cariId:f.cariId,tahminiTutar:'9999',asama:'yeni_lead'});}
const path=(id:string,invoice:string)=>`/crm/firsatlar/${id}/belgeler/faturalar/${invoice}`;
async function allocation(f:any,opp:string,invoice:string,iade:string,matrah:string){
 const view=await json(path(opp,invoice)+'/iade-paylari',f.auth),i=view.iadeler.find((i:any)=>i.id===iade);
 const body={iadeFaturaId:iade,matrah,gerekce:'Gerçek HTTP iade dağıtım provası',istekAnahtari:randomUUID(),beklenenSurum:i.surum,kanitOzeti:i.kanitOzeti};
 return {body,result:await json(path(opp,invoice)+'/iade-paylari',f.auth,body)};
}


async function tarayiciBaslat(){
 if(webAdres)return webAdres;
 // Web yalnız kopyalanmış kaynaklardan ve ayrı portta çalışır; asıl Next ayarlarına yazmaz.
 await mkdir(artifacts,{recursive:true});const standalone=process.env.F03_WEB_ROOT;
 const webDir=standalone??await mkdtemp(resolve(artifacts,'web-'));
 if(!standalone)for(const name of ['src','public','package.json','next.config.ts','tsconfig.json','next-env.d.ts']){
  try{await cp(resolve(root,'apps/web',name),resolve(webDir,name),{recursive:true});}catch(e){if(name!=='public' || (e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 if(!standalone)await symlink(resolve(root,'apps/web/node_modules'),resolve(webDir,'node_modules'),'dir');
 const socket=netServer();await new Promise<void>(ok=>socket.listen(0,'127.0.0.1',ok));const webPort=(socket.address() as {port:number}).port;await new Promise<void>(ok=>socket.close(()=>ok()));
 let output='';web=spawn(process.execPath,standalone?[resolve(webDir,'server.js')]:[resolve(root,'apps/web/node_modules/next/dist/bin/next'),'dev','-H','127.0.0.1','-p',String(webPort)],{cwd:webDir,env:{...process.env,...(!standalone?{NEXT_PUBLIC_API_URL:base,NEXT_DIST_DIR:'.next-http'}:{}),NODE_ENV:standalone?'production':'development',HOSTNAME:'127.0.0.1',PORT:String(webPort),NODE_OPTIONS:'--max-old-space-size=1536'},stdio:['ignore','pipe','pipe']});
 web.stdout!.on('data',d=>output+=d);web.stderr!.on('data',d=>output+=d);
 let webUrl='';for(let n=0;n<240;n++){
  if(web.exitCode!==null)throw Error('İzole web başlatılamadı: '+output.slice(-1500));
  webUrl=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';
  if(webUrl){try{if((await fetch(webUrl+'/giris',{signal:AbortSignal.timeout(1500)})).ok)break;}catch{/* derleniyor */}}
  await new Promise(r=>setTimeout(r,500));
 }
 expect(webUrl).toMatch(/:\d+$/);
 if(standalone){
  // Aynı origin proxy /api/v1'i test API'sine taşır; paketin 3001 rewrite'ına gidilmez.
  const nextUrl=webUrl;
  proxy=createServer((q,s)=>{
   const target=new URL(q.url?.startsWith('/api/v1/')?base:nextUrl);
   const upstream=proxyRequest({hostname:'127.0.0.1',port:target.port,path:q.url,method:q.method,headers:q.headers},r=>{s.writeHead(r.statusCode??502,r.headers);r.pipe(s);});
   upstream.on('error',()=>{s.writeHead(502);s.end();});q.pipe(upstream);
  });
  await new Promise<void>(ok=>proxy!.listen(0,'127.0.0.1',ok));webUrl=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;
 }
 const browserApi=standalone?webUrl+'/api/v1':base;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 webAdres={webUrl,browserApi};return webAdres;
}

it('gerçek HTTP: iki fırsat/teklif → onaylı siparişler → karma kesin fatura → kesin iade → parolalı Chromium dağıtımı',async()=>{
 const f=await fixture(),a=await opportunity(f),b=await opportunity(f),orders:string[]=[];
 for(const opp of [a,b]){
  const body={istekAnahtari:randomUUID(),gerekce:'HTTP teklif talebi',beklenenFirsatZamani:opp.updatedAt,belge:{tur:'teklif',yon:'satis',cariId:f.cariId,tarih:'2026-10-18',dovizCinsi:'TRY',kur:'1',satirlar:[{stokId:f.stokId,miktar:'1',birimFiyat:'100.10',iskontoOrani:'0',kdvOrani:'20'}]}};
  const quote=await json(`/crm/firsatlar/${opp.id}/belgeler/teklif`,f.auth,body);
  expect(await json(`/crm/firsatlar/${opp.id}/belgeler/teklif`,f.auth,body)).toEqual(quote);
  await json(`/belgeler/${quote.id}/onayla`,f.auth,{});
  const order=await json(`/belgeler/${quote.id}/donustur`,f.auth,{hedef:'siparis'});orders.push(order.belgeId);
  await json(`/belgeler/${order.belgeId}/onayla`,f.auth,{});
 }
 const combined=await json('/belgeler/toplu-fatura',f.auth,{belgeIds:orders});
 const invoice=combined.faturaId;expect(invoice).toBeTruthy();
 const kesin=await json(`/fatura/${invoice}/kesinlestir`,f.auth,{});expect(kesin.durum).toBe('kesin');
 const result=await json(`/crm/firsatlar/${a.id}/belgeler`,f.auth);
 expect(result.ticariSonuc).toHaveLength(1);expect(result.ticariSonuc[0]).toMatchObject({faturaPayi:'120.12',payKapsami:'kismi'});
 expect(JSON.stringify(result)).not.toMatch(/maliyet|parolaHash|tahminiTutar/);
 const iade=await json('/fatura',f.auth,{tip:'satis_iade',cariId:f.cariId,tarih:'2026-10-18',dovizCinsi:'TRY',kur:'1',satirlar:[{stokId:f.stokId,miktar:'1',birimFiyat:'50.05',kdvOrani:'20'}]});
 // Bu kayıt gelen e-belge alımının yerine konan tek kaynak fixture'ıdır; sağlayıcı çağrılmaz.
 await tx(f,(t:any)=>t.faturaIadeReferansi.create({data:{tenantId:f.tenantId,faturaId:iade.id,kaynakFaturaId:invoice,sira:1,belgeNo:kesin.no,tarih:new Date('2026-10-18')}}));
 expect((await json(`/fatura/${iade.id}/kesinlestir`,f.auth,{})).durum).toBe('kesin');
 const other=await allocation(f,b.id,invoice,iade.id,'30.00');
 expect(await json(path(b.id,invoice)+'/iade-paylari',f.auth,other.body)).toEqual(other.result);
 expect((await json(path(a.id,invoice)+'/iade-paylari',f.auth)).sonuc.netMatrah).toBeNull();
 const before=await tx(f,async(t:any)=>JSON.stringify([await t.fatura.findMany({orderBy:{id:'asc'}}),await t.cariHareket.findMany({orderBy:{id:'asc'}}),await t.faturaKapama.findMany({orderBy:{id:'asc'}}),await t.stokHareket.findMany()]));

 const {webUrl,browserApi}=await tarayiciBaslat();
 const page=await browser!.newPage(),apiRequests:string[]=[],pageErrors:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/v1/'))apiRequests.push(r.url());});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(webUrl+'/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(f.eposta);await page.getByLabel('Parola',{exact:true}).fill(f.parola);
 const loginPromise=page.waitForResponse(r=>r.url()===browserApi+'/auth/giris' && r.request().method()==='POST');await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();expect((await loginPromise).status()).toBe(201);
 await page.waitForURL('**/panel');await page.goto(webUrl+`/panel/crm/${a.id}`);
 await page.getByRole('button',{name:'Ticari iade dağıtımını aç',exact:true}).click();
 const region=page.getByRole('region',{name:'Ticari iade dağıtımı',exact:true});await region.getByLabel('Ticari iade',{exact:true}).selectOption(iade.id);
 await region.getByLabel('İade matrah payı',{exact:true}).fill('20,05');await region.getByLabel('Ticari iade gerekçesi',{exact:true}).fill('Tarayıcıdan gerçek API dağıtımı');
 const save=page.waitForResponse(r=>r.url()===browserApi+path(a.id,invoice)+'/iade-paylari' && r.request().method()==='POST');await region.getByRole('button',{name:'Ticari iade payını kaydet',exact:true}).click();expect((await save).status()).toBe(201);
 await page.getByText('₺80,05',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Ticari iade dağıtımını aç',exact:true}).click();await page.getByText('₺80,05',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.locator('#ana-menu').evaluate(e=>e.getBoundingClientRect().right),{timeout:5000}).toBeLessThanOrEqual(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:resolve(artifacts,'gercek-api-mobil.png'),fullPage:true});
 expect(apiRequests.length).toBeGreaterThan(5);expect(apiRequests.every(u=>u.startsWith(browserApi+'/'))).toBe(true);expect(pageErrors).toEqual([]);
 const final=await json(path(a.id,invoice)+'/iade-paylari',f.auth);expect(final.sonuc).toMatchObject({durum:'tam',satisMatrahi:'100.10',belirtilenIadeMatrahi:'20.05',netMatrah:'80.05'});
 expect((await json(path(b.id,invoice)+'/iade-paylari',f.auth)).sonuc.netMatrah).toBe('70.10');
 expect(await tx(f,async(t:any)=>JSON.stringify([await t.fatura.findMany({orderBy:{id:'asc'}}),await t.cariHareket.findMany({orderBy:{id:'asc'}}),await t.faturaKapama.findMany({orderBy:{id:'asc'}}),await t.stokHareket.findMany()]))).toBe(before);
 expect(await tx(f,(t:any)=>t.firsatIadePayi.count())).toBe(2);
 await writeFile(resolve(artifacts,'http-tarayici-sonucu.json'),JSON.stringify({tarih:new Date().toISOString(),durum:'gecti',standalone:!!process.env.F03_WEB_ROOT,gercekParolaGirisi:true,apiYanitiTaklidi:false,tokenEnjeksiyonu:false,referansFixture:true,tarayiciApiIstekSayisi:apiRequests.length,netMatrahlar:['80.05','70.10'],gercekSirketPilotu:false},null,2));
 await page.close();
});

it('derlenmiş gerçek guard/controller: anonim, bozuk JWT, rol, tenant ve şirket modu sınırları',async()=>{
 const f=await fixture(),foreign=await fixture(),opp=await opportunity(f),target=`/crm/firsatlar/${opp.id}/belgeler`,allocationPath=path(opp.id,randomUUID())+'/iade-paylari';
 for(const auth of [undefined,'bozuk',jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'yonetici'},{expiresIn:-1}),jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'yonetici',kapsam:'platform'})])expect((await http(target,auth)).status).toBe(401);
 expect((await http(target,foreign.auth)).status).toBe(404);
 const sales=jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'satis'});
 expect((await http(allocationPath,sales,{},'POST')).status).toBe(403);
 expect((await http(target,jwt.sign({sub:f.userId,tenantId:f.tenantId,rol:'depo'}))).status).toBe(403);
 await tx(f,(t:any)=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'salt_okunur'}}}));
 expect((await http(target,f.auth)).status).toBe(200);
 const body={iadeFaturaId:randomUUID(),matrah:'1',gerekce:'Salt okunur kontrolü',istekAnahtari:randomUUID(),beklenenSurum:0,kanitOzeti:'a'.repeat(64)};
 expect((await http(allocationPath,f.auth,body,'POST')).status).toBe(403);
 await tx(f,(t:any)=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:'crm_belge_baglari'}},data:{ayarlar:{surum:1,mod:'kapali'}}}));expect((await http(target,f.auth)).status).toBe(403);
});

it('gerçek HTTP ve tarayıcı: iki kaynak faturanın tek iadesi tamamlanmadan netleşmez, her fırsat yalnız kendi payını alır',async()=>{
 const f=await fixture(),a=await opportunity(f),b=await opportunity(f),sources:{id:string;no:string;opp:string}[]=[];
 for(const opp of [a,b]){
  const quote=await json(`/crm/firsatlar/${opp.id}/belgeler/teklif`,f.auth,{istekAnahtari:randomUUID(),gerekce:'Çok kaynaklı iade satış zinciri',beklenenFirsatZamani:opp.updatedAt,belge:{tur:'teklif',yon:'satis',cariId:f.cariId,tarih:'2026-10-18',dovizCinsi:'TRY',kur:'1',satirlar:[{stokId:f.stokId,miktar:'1',birimFiyat:'100.10',iskontoOrani:'0',kdvOrani:'20'}]}});
  await json(`/belgeler/${quote.id}/onayla`,f.auth,{});
  const order=await json(`/belgeler/${quote.id}/donustur`,f.auth,{hedef:'siparis'});
  await json(`/belgeler/${order.belgeId}/onayla`,f.auth,{});
  const converted=await json('/belgeler/toplu-fatura',f.auth,{belgeIds:[order.belgeId]});
  const invoice=await json(`/fatura/${converted.faturaId}/kesinlestir`,f.auth,{});
  expect(invoice.durum).toBe('kesin');sources.push({id:converted.faturaId,no:invoice.no,opp:opp.id});
 }
 const [first,second]=sources;
 expect(first.id).not.toBe(second.id);
 const iade=await json('/fatura',f.auth,{tip:'satis_iade',cariId:f.cariId,tarih:'2026-10-18',dovizCinsi:'TRY',kur:'1',satirlar:[{stokId:f.stokId,miktar:'1',birimFiyat:'50.05',kdvOrani:'20'}]});
 // Yalnız dış belge referansları fixture'dır; satış ve iade kesinleşmesi gerçek HTTP'dir.
 await tx(f,async(t:any)=>{for(let n=0;n<sources.length;n++)await t.faturaIadeReferansi.create({data:{tenantId:f.tenantId,faturaId:iade.id,kaynakFaturaId:sources[n].id,sira:n+1,belgeNo:sources[n].no,tarih:new Date('2026-10-18')}});});
 expect((await json(`/fatura/${iade.id}/kesinlestir`,f.auth,{})).durum).toBe('kesin');
 const snapshot=()=>tx(f,async(t:any)=>JSON.stringify([await t.fatura.findMany({orderBy:{id:'asc'}}),await t.faturaSatir.findMany({orderBy:{id:'asc'}}),await t.cariHareket.findMany({orderBy:{id:'asc'}}),await t.faturaKapama.findMany({orderBy:{id:'asc'}}),await t.stokHareket.findMany({orderBy:{id:'asc'}})]));
 const before=await snapshot();
 const other=await allocation(f,b.id,second.id,iade.id,'30.00');
 expect(await json(path(b.id,second.id)+'/iade-paylari',f.auth,other.body)).toEqual(other.result);
 for(const source of sources){
  const view=await json(path(source.opp,source.id)+'/iade-paylari',f.auth);
  expect(view.sonuc.netMatrah).toBeNull();expect(view.iadeler[0]).toMatchObject({dagitimDurumu:'eksik',dagitilanMatrah:'30.00',kalanMatrah:'20.05'});
  expect(view.iadeler[0].kaynakFaturalar.map((s:any)=>s.id).sort()).toEqual(sources.map(s=>s.id).sort());
 }
 const {webUrl,browserApi}=await tarayiciBaslat();
 const page=await browser!.newPage(),apiRequests:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/v1/'))apiRequests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(webUrl+'/giris');await page.getByRole('textbox',{name:'E-posta Adresi',exact:true}).fill(f.eposta);await page.getByLabel('Parola',{exact:true}).fill(f.parola);
 const login=page.waitForResponse(r=>r.url()===browserApi+'/auth/giris'&&r.request().method()==='POST');await page.getByRole('button',{name:'Giriş Yap',exact:true}).click();expect((await login).status()).toBe(201);
 await page.waitForURL('**/panel');await page.goto(webUrl+`/panel/crm/${a.id}`);
 await page.getByRole('button',{name:'Ticari iade dağıtımını aç',exact:true}).click();
 const region=page.getByRole('region',{name:'Ticari iade dağıtımı',exact:true});
 await region.getByText('Dağıtım eksik veya kaynak geçersiz',{exact:true}).waitFor();
 for(const source of sources)expect(await region.textContent()).toContain(source.no);
 await region.getByLabel('Ticari iade',{exact:true}).selectOption(iade.id);
 await region.getByLabel('İade matrah payı',{exact:true}).fill('20,05');await region.getByLabel('Ticari iade gerekçesi',{exact:true}).fill('İki kaynak faturadan ilk fırsata ayrılan iade');
 const saved=page.waitForResponse(r=>r.url()===browserApi+path(a.id,first.id)+'/iade-paylari'&&r.request().method()==='POST');
 await region.getByRole('button',{name:'Ticari iade payını kaydet',exact:true}).click();expect((await saved).status()).toBe(201);
 await region.getByText('₺80,05',{exact:true}).waitFor();expect(await region.textContent()).toContain('Dağıtım tamam');
 await page.reload();await page.getByRole('button',{name:'Ticari iade dağıtımını aç',exact:true}).click();await region.getByText('₺80,05',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.locator('#ana-menu').evaluate(e=>e.getBoundingClientRect().right),{timeout:5000}).toBeLessThanOrEqual(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(artifacts,'cok-kaynakli-iade-mobil.png'),fullPage:true});
 for(const [source,net,pay] of [[first,'80.05','20.05'],[second,'70.10','30.00']] as const){
  const view=await json(path(source.opp,source.id)+'/iade-paylari',f.auth);expect(view.sonuc).toMatchObject({durum:'tam',satisMatrahi:'100.10',belirtilenIadeMatrahi:pay,netMatrah:net});
  expect(view.iadeler[0]).toMatchObject({dagitimDurumu:'tam',dagitilanMatrah:'50.05',kalanMatrah:'0.00'});
  const list=await json(`/crm/firsatlar/${source.opp}/belgeler`,f.auth);expect(list.ticariSonuc).toHaveLength(1);expect(list.ticariSonuc[0]).toMatchObject({id:source.id,netSatis:{durum:"referans_kapsaminda",netMatrah:net}});
  expect(JSON.stringify(list)).not.toMatch(/maliyet|parolaHash|tahminiTutar/);
 }
 expect(await snapshot()).toBe(before);expect(await tx(f,(t:any)=>t.firsatIadePayi.count())).toBe(2);
 expect(apiRequests.length).toBeGreaterThan(5);expect(apiRequests.every(u=>u.startsWith(browserApi+'/'))).toBe(true);expect(errors).toEqual([]);
 await writeFile(resolve(artifacts,'cok-kaynakli-http-sonucu.json'),JSON.stringify({durum:'gecti',tarih:new Date().toISOString(),standalone:!!process.env.F03_WEB_ROOT,gercekParolaGirisi:true,referansFixture:true,apiYanitiTaklidi:false,kaynakFaturaSayisi:2,iadeSayisi:1,netMatrahlar:['80.05','70.10'],finansKayitlariAyni:true,gercekSirketPilotu:false},null,2));
 await page.close();
});
