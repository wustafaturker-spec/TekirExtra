import 'reflect-metadata';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,relative,dirname} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {Module} from '@nestjs/common';
import {NestFactory,Reflector} from '@nestjs/core';
import {JwtService} from '@nestjs/jwt';
import {beforeAll,afterAll,it,expect} from 'vitest';
const url=process.env.F01_YARIS_DB_URL,dist=process.env.F04_API_DIST,eski=process.env.F04_ESKI_API_DIST;
const fixture={tenantId:process.env.F04_PROVA_TENANT_ID!,planId:process.env.F04_PROVA_PLAN_ID!,talepId:process.env.F04_PROVA_TALEP_ID!,userId:process.env.F04_PROVA_USER_ID!};
if(!url||!dist||!eski||!process.env.F01_YARIS_NONCE||Object.values(fixture).some(v=>!v||!/^[a-f0-9-]{36}$/.test(v)))throw Error('Yalnız --f04-prova restore fixture runner ile çalıştırın');
const modFixture=JSON.parse(process.env.F04_PROVA_MOD_FIXTURE??'null');
if(!modFixture||![modFixture.tenantId,modFixture.userId,modFixture.planId].every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)))throw Error('Restore şirket modu fixture kapsamı doğrulanamadı');
const u=new URL(url);if(u.hostname!=='127.0.0.1'||!/^\/f01_yaris_[a-f0-9]{16}$/.test(u.pathname)||u.username!=='tekir_app'||['5432','5433'].includes(u.port))throw Error('Geçici restore DB kapsamı doğrulanamadı');
const req=createRequire(import.meta.url),load=(p:string)=>req(resolve(dist,p+'.js')),old=(p:string)=>req(resolve(eski,p+'.js'));
load('ayar-tanimlari');
const {PrismaService}=load('core/prisma.service'),{baglamlaCalistir}=load('core/istek-baglami'),{IhtiyacService}=load('stok/ihtiyac.service'),{IhtiyacPlanService}=load('stok/ihtiyac-plan.service'),{SatinAlmaService}=load('satin-alma/satin-alma.service'),{ButceService}=load('butce/butce.service');
const {IhtiyacController:OldController}=old('stok/ihtiyac.controller'),{IhtiyacService:OldService}=old('stok/ihtiyac.service'),{PrismaService:OldPrisma}=old('core/prisma.service'),{AuthGuard:OldAuthGuard}=old('auth/auth.guard'),{RollerGuard:OldRollerGuard}=old('auth/roller.guard'),{bosTutucuylaCalistir:oldContext}=old('core/istek-baglami');
const db=new PrismaService({datasourceUrl:url}),oldDb=new OldPrisma({datasourceUrl:url}),ihtiyac=new IhtiyacService(db),plan=new IhtiyacPlanService(db,ihtiyac);
const satinAlma=new SatinAlmaService(db,{} as never,{} as never,new ButceService(db),undefined,ihtiyac);
const ctx=(fn:()=>Promise<any>,tenantId=fixture.tenantId)=>baglamlaCalistir({tenantId,userId:fixture.userId,rol:'depo'},fn);
const tx=(fn:(t:any)=>Promise<any>)=>ctx(()=>db.tenantIslem(fixture.tenantId,fn));
const evidence=resolve(process.env.F04_HTTP_EVIDENCE!);
let app:any,base:string;
const jwt=new JwtService({secret:randomBytes(32).toString('hex')});
beforeAll(async()=>{
 const [r]=await db.$queryRaw`SELECT current_database() AS db,current_setting('tekir.f01_yaris_nonce',true) AS nonce,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 expect(r).toEqual({db:u.pathname.slice(1),nonce:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
 // Eski paket yeniden derlenmez; kullanılan modüller 19 Ekim runtime manifestiyle eşleşmeli.
 const manifest=JSON.parse(await readFile(resolve(dirname(eski),'runtime-manifest.json'),'utf8')),hashes:Record<string,string>={};
 for(const file of Object.keys(req.cache).filter(p=>p.startsWith(resolve(eski)+'/')).sort()){
  const key=relative(eski,file),hash=createHash('sha256').update(await readFile(file)).digest('hex');expect(hash,key).toBe(manifest.dosyalar['apps/api/dist/'+key]);hashes[key]=hash;
 }
 expect(hashes['stok/ihtiyac.service.js']).toBeTruthy();
 await writeFile(resolve(evidence,'eski-api-kaynak-kaniti.json'),JSON.stringify({paket:eski,manifest:'19 Ekim runtime-manifest.json',kullanilanModuller:hashes,tamUygulamaDegil:true},null,2));
 class OldModule{};Module({controllers:[OldController],providers:[{provide:OldService,useValue:new OldService(oldDb)}]})(OldModule);
 app=await NestFactory.create(OldModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api/v1');app.use((_q:unknown,_s:unknown,next:()=>void)=>oldContext(next));app.useGlobalGuards(new OldAuthGuard(jwt,new Reflector()),new OldRollerGuard(new Reflector()));await app.listen(0,'127.0.0.1');base=(await app.getUrl())+'/api/v1/stok/ihtiyac-plani';
});
afterAll(async()=>{await app?.close();await oldDb.$disconnect();await db.$disconnect();});
it('restore edilen tarihsel plan, kaynak payı ve talep bağı gerçek yeni servislerden okunur',async()=>{
 const r=await ctx(()=>plan.oku(fixture.planId));expect(r).toMatchObject({id:fixture.planId,guncel:true,satinAlmaBagi:{talepId:fixture.talepId}});expect(r.karsilamaBaglari).toHaveLength(1);expect(r.karsilamaBaglari[0].miktar.toFixed(3)).toBe('7.000');expect(r.snapshot.tarihli.eksik).toBe('1.000');
});
it('restore sonrası aynı plan-talep isteği yeni talep, sayaç, olay veya audit yazmaz',async()=>{
 const t=await tx((t:any)=>t.satinAlmaTalebi.findUnique({where:{id:fixture.talepId},include:{kalemler:{orderBy:{sira:'asc'}}}}));expect(t.durum).toBe('taslak');
 const g={ihtiyacPlaniId:fixture.planId,departmanId:t.departmanId,ihtiyacTarihi:t.ihtiyacTarihi.toISOString().slice(0,10),gerekce:t.gerekce,butceAnahtari:t.butceAnahtari,kalemler:t.kalemler.map((k:any)=>({stokId:k.stokId,miktar:k.miktar.toFixed(3),tahminiBirimFiyat:k.tahminiBirimFiyat.toString()}))};
 expect(await ctx(()=>satinAlma.olustur(g))).toEqual({id:t.id,no:t.no});
});
it('restore sonrası RLS, değişmezlik ve bileşik FK korumaları devam eder',async()=>{
 const yabanci=randomUUID();await expect(ctx(()=>plan.oku(fixture.planId),yabanci)).rejects.toMatchObject({status:403});
 await expect(tx((t:any)=>t.ihtiyacPlani.update({where:{id:fixture.planId},data:{snapshot:{degisti:true}}}))).rejects.toThrow();
 await expect(tx((t:any)=>t.ihtiyacSatinAlmaBagi.deleteMany({where:{planId:fixture.planId}}))).rejects.toThrow();
 await expect(tx((t:any)=>t.ihtiyacSatinAlmaBagi.create({data:{tenantId:fixture.tenantId,planId:randomUUID(),talepId:fixture.talepId,userId:fixture.userId,istekOzeti:'a'.repeat(64)}}))).rejects.toThrow();
 // Kullanılmayan kimliklerle iki FK ayrı sınanır; unique çakışması FK kanıtı sayılmaz.
 await expect(tx((t:any)=>t.ihtiyacSatinAlmaBagi.create({data:{tenantId:fixture.tenantId,planId:randomUUID(),talepId:randomUUID(),userId:fixture.userId,istekOzeti:'a'.repeat(64)}}))).rejects.toThrow();
 const rows=await tx((t:any)=>t.$queryRaw`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('siparis_giris_tarihleri','ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari','ihtiyac_satin_alma_baglari') ORDER BY relname`);expect(rows).toHaveLength(5);for(const r of rows)expect(r).toMatchObject({relrowsecurity:true,relforcerowsecurity:true});
});
it('19 Ekim derlenmiş eski HTTP önizlemesi yeni şemada çalışır; yeni rotalar onda yoktur, kayıtlar korunur',async()=>{
 const p=await ctx(()=>plan.oku(fixture.planId));const token=jwt.sign({sub:fixture.userId,tenantId:fixture.tenantId,rol:'depo'}),query=new URLSearchParams(p.girdi);
 const result=await fetch(base+'/onizle?'+query,{headers:{Authorization:'Bearer '+token}});expect(result.status).toBe(200);const r=await result.json();expect(r.hesap).toMatchObject({mevcut:'10.000',rezerve:'0.000',kullanilabilir:'10.000',eksik:'0.000'});expect(r).not.toHaveProperty('tarihli');
 expect((await fetch(base+'/onizle?'+query)).status).toBe(401);
 expect((await fetch(base+'/planlar/'+fixture.planId,{headers:{Authorization:'Bearer '+token}})).status).toBe(404);
 expect((await ctx(()=>plan.oku(fixture.planId))).snapshot).toEqual(p.snapshot);
 await writeFile(resolve(evidence,'geri-donus-ozeti.json'),JSON.stringify({durum:'gecti',eskiApi:'19 Ekim anlık önizleme controller/servisi',yeniSema:true,anlikEksik:r.hesap.eksik,tarihliEksik:p.snapshot.tarihli.eksik,yeniTarihselKayitlarKorundu:true,tamEskiUygulamaVeyaWebTesti:false,bagimliliklar:'mevcut lockfile ve üretilmiş Prisma istemcisi',gercekSirketPilotu:false},null,2));
});

it('restore şirket modu, dört yönetici audit kaydı ve güncel erişim bilgisini korur',async()=>{
 const r=await baglamlaCalistir({tenantId:modFixture.tenantId,userId:modFixture.userId,rol:'yonetici'},async()=>{
  const p=await plan.oku(modFixture.planId);
  const veriler=await db.tenantIslem(modFixture.tenantId,async(t:any)=>({ayar:await t.modulAyar.findUnique({where:{tenantId_modul:{tenantId:modFixture.tenantId,modul:'stok_ihtiyac_plani'}}}),audit:await t.auditLog.findMany({where:{islem:'ihtiyac_modu_guncellendi'}})}));
  expect(veriler.ayar.ayarlar).toEqual({surum:1,mod:'pilot'});
  expect(veriler.audit).toHaveLength(4);
  expect(veriler.audit.map((a:any)=>a.detay.mod).sort()).toEqual(['kapali','pilot','pilot','salt_okunur']);
  for(const a of veriler.audit){expect(a.userId).toBe(modFixture.userId);expect(a.varlikId).toBe(veriler.ayar.id);}
  expect(p).toMatchObject({id:modFixture.planId,guncel:true,erisim:{mod:'pilot',yazabilir:true}});
  return {durum:'gecti',mod:p.erisim.mod,auditAdedi:veriler.audit.length,planGuncel:p.guncel,yazabilir:p.erisim.yazabilir};
 });
 await writeFile(resolve(evidence,'restore-mod-ozeti.json'),JSON.stringify(r,null,2));
});
