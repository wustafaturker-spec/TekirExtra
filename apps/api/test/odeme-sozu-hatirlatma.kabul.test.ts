import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { OdemeSozuHatirlatmaService } from "../src/cari/odeme-sozu-hatirlatma.service";

const url=process.env.F01_YARIS_DB_URL;
if(!url||!process.env.F01_YARIS_NONCE)throw Error("Yalnız izole F02 kabul koşucusuyla çalıştırın");
const u=new URL(url);if(u.hostname!=="127.0.0.1"||!/^\/f01_yaris_[a-f0-9]{16}$/.test(u.pathname)||u.username!=="tekir_app"||["5432","5433"].includes(u.port))throw Error("Geçici DB kapsamı gerekli");
const a=new PrismaService({datasourceUrl:url}), b=new PrismaService({datasourceUrl:url});
const bugun=new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Istanbul"}), saat=new Date(bugun+"T09:00:00Z");
const once=new Date(new Date(bugun).getTime()-3*86400000);
beforeAll(async()=>{
 const [r]=await a.$queryRaw<any[]>`SELECT current_setting('tekir.f01_yaris_nonce',true) AS marker,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
 expect(r).toEqual({marker:process.env.F01_YARIS_NONCE,rolsuper:false,rolbypassrls:false});
 vi.spyOn(Logger.prototype,"error").mockImplementation(()=>undefined);
});
afterAll(async()=>{vi.restoreAllMocks();await Promise.all([a.$disconnect(),b.$disconnect()]);});
async function fixture(fark=0){
 const tenantId=randomUUID();
 return a.tenantIslem(tenantId,async tx=>{
  await tx.tenant.create({data:{id:tenantId,vkn:tenantId,unvan:"Hatırlatma test firması"}});
  const user=await tx.user.create({data:{tenantId,eposta:tenantId+"@test.invalid",parolaHash:"test",adSoyad:"Test",rol:"yonetici"}});
  const cari=await tx.cariHesap.create({data:{tenantId,kod:"C1",unvan:"Test müşteri",tip:"musteri",eposta:"cari@example.invalid"}});
  const fatura=await tx.fatura.create({data:{tenantId,cariId:cari.id,tip:"satis",durum:"kesin",no:"TEST-001",tarih:once,dovizCinsi:"TRY",kur:"1",genelToplam:"2000",toplamBrut:"2000",toplamMatrah:"2000",toplamSatirIskontosu:"0",genelIskontoToplam:"0",toplamKdv:"0",toplamTevkifat:"0",toplamNetKdv:"0"}});
  await tx.modulAyar.create({data:{tenantId,modul:"tahsilat_operasyonu",ayarlar:{mod:"pilot"}}});
  const soz=await tx.odemeSozu.create({data:{tenantId,cariId:cari.id,faturaId:fatura.id,dovizCinsi:"TRY",tutar:"1000",sozTarihi:new Date(new Date(bugun).getTime()+fark*86400000),verildigiZaman:once,olusturanUserId:user.id,aciklama:"Test",istekAnahtari:randomUUID(),girdiOzeti:"a".repeat(64)}});
  return{tenantId,userId:user.id,cariId:cari.id,faturaId:fatura.id,sozId:soz.id};
 });
}
type F=Awaited<ReturnType<typeof fixture>>;
const tx=<T>(f:F,fn:(t:Prisma.TransactionClient)=>Promise<T>)=>baglamlaCalistir({tenantId:f.tenantId,userId:f.userId,rol:"yonetici"},()=>a.tenantIslem(f.tenantId,fn));
function kur(db=a,send=vi.fn().mockResolvedValue({messageId:"test"})){
 const service=new OdemeSozuHatirlatmaService(db,{odemeSozuHatirlat:send} as never);
 vi.spyOn(service as any,"zaman").mockResolvedValue(saat);
 return{service,send};
}
const kayit=(f:F)=>tx(f,t=>t.odemeSozuHatirlatma.findUnique({where:{tenantId_sozId:{tenantId:f.tenantId,sozId:f.sozId}}}));

describe("Söz günü hatırlatma DB/SMTP sınırı",()=>{
 it("aynı söz tekrarlı tarama ve yeniden başlatmada yalnız bir kez gönderilir",async()=>{
  const f=await fixture(),{service,send}=kur();await service.taraTenant(f.tenantId);await service.taraTenant(f.tenantId);
  const ikinci=kur(b,send);await ikinci.service.taraTenant(f.tenantId);expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toMatchObject({alici:"cari@example.invalid",messageId:`<odeme-sozu-${f.sozId}@tekirextra.local>`});
  expect(send.mock.calls[0][0].metin).toContain("1000.00 TRY");expect((await kayit(f))?.durum).toBe("gonderildi");
 });
 it("iki ayrı DB istemcisinin yarışında tek gönderim ayrılır",async()=>{
  const f=await fixture(),send=vi.fn().mockResolvedValue({});const x=kur(a,send),y=kur(b,send);
  await Promise.all([x.service.taraTenant(f.tenantId),y.service.taraTenant(f.tenantId)]);expect(send).toHaveBeenCalledTimes(1);
 });
 it("saat 09 öncesinde göndermez",async()=>{
  const f=await fixture(),{service,send}=kur();vi.spyOn(service as any,"zaman").mockResolvedValue(new Date(bugun+"T05:59:00Z"));await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it.each([-1,1])("sözün farklı gününde göndermez: %s",async fark=>{
  const f=await fixture(fark);
  const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it.each(["iptal","revize"])("%s söz atlanır",async kayitDurumu=>{
  const f=await fixture();await tx(f,t=>t.odemeSozu.update({where:{id:f.sozId},data:{kayitDurumu,sonlandirmaNedeni:"Test",surum:{increment:1}}}));const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it.each(["kapali","salt_okunur"])("%s şirket atlanır",async mod=>{
  const f=await fixture();await tx(f,t=>t.modulAyar.update({where:{tenantId_modul:{tenantId:f.tenantId,modul:"tahsilat_operasyonu"}},data:{ayarlar:{mod}}}));const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it.each([null,"hatalı", "a@example.invalid,b@example.invalid"])("geçersiz/eksik alıcıya göndermez: %s",async eposta=>{
  const f=await fixture();await tx(f,t=>t.cariHesap.update({where:{id:f.cariId},data:{eposta}}));const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();expect(await kayit(f)).toBeNull();
 });
 it("açık itirazı olan cariye göndermez",async()=>{
  const f=await fixture();await tx(f,t=>t.tahsilatTakibi.create({data:{tenantId:f.tenantId,cariId:f.cariId,sorumluUserId:f.userId,olusturanUserId:f.userId,konu:"İtiraz",neden:"itiraz",durum:"acik",sonrakiIslemTarihi:new Date(bugun),sonrakiIslem:"İncele",istekAnahtari:randomUUID(),girdiOzeti:"b".repeat(64)}}));
  const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it("tam ödenmiş faturaya aynı gün tahsilatında da göndermez",async()=>{
  const f=await fixture();await tx(f,async t=>{const h=await t.kasaBankaHareket.create({data:{tenantId:f.tenantId,cariId:f.cariId,tip:"tahsilat",tutar:"2000",dovizCinsi:"TRY",kur:"1",tutarTry:"2000",tarih:new Date(bugun),kaynakTur:"manuel"}});await t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:f.faturaId,tutar:"2000",kasaBankaHareketId:h.id,otomatik:true}});});
  const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();
 });
 it("kısmi tahsilatta güncel kalan tutarı hatırlatır",async()=>{
  const f=await fixture();await tx(f,async t=>{const h=await t.kasaBankaHareket.create({data:{tenantId:f.tenantId,cariId:f.cariId,tip:"tahsilat",tutar:"400",dovizCinsi:"TRY",kur:"1",tutarTry:"400",tarih:new Date(new Date(bugun).getTime()-86400000),createdAt:new Date(new Date(bugun).getTime()-86400000),kaynakTur:"manuel"}});await t.faturaKapama.create({data:{tenantId:f.tenantId,cariId:f.cariId,faturaId:f.faturaId,tutar:"400",kasaBankaHareketId:h.id,otomatik:true}});});
  const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send.mock.calls[0][0].metin).toContain("Hatırlatılan kalan tutar: 600.00 TRY");
 });
 it("kesin bağlantı hatası ertelenir; bekleme dolunca en fazla üç deneme yapılır",async()=>{
  const f=await fixture(),{service,send}=kur(a,vi.fn().mockRejectedValue(Object.assign(new Error("connect failed"),{code:"ECONNECTION"})));
  await service.taraTenant(f.tenantId);await service.taraTenant(f.tenantId);expect(send).toHaveBeenCalledTimes(1);
  for(let i=0;i<3;i++){await tx(f,t=>t.odemeSozuHatirlatma.update({where:{tenantId_sozId:{tenantId:f.tenantId,sozId:f.sozId}},data:{sonrakiDenemeAt:new Date(0)}}));await service.taraTenant(f.tenantId);}
  expect(send).toHaveBeenCalledTimes(3);expect((await kayit(f))?.deneme).toBe(3);
 });
 it("DATA zaman aşımı belirsiz kalır ve otomatik tekrarlanmaz",async()=>{
  const f=await fixture(),{service,send}=kur(a,vi.fn().mockRejectedValue(Object.assign(new Error("timeout DATA"),{code:"ETIMEDOUT",command:"DATA"})));
  await service.taraTenant(f.tenantId);await service.taraTenant(f.tenantId);expect(send).toHaveBeenCalledTimes(1);expect((await kayit(f))?.durum).toBe("belirsiz");
 });
 it("süreç kesilmesinden kalan gönderim tekrar edilmez",async()=>{
  const f=await fixture();await tx(f,t=>t.odemeSozuHatirlatma.create({data:{tenantId:f.tenantId,sozId:f.sozId,alici:"cari@example.invalid",konu:"Test",baslangicAt:new Date(saat.getTime()-11*60000)}}));
  const{service,send}=kur();await service.taraTenant(f.tenantId);expect(send).not.toHaveBeenCalled();expect((await kayit(f))?.durum).toBe("belirsiz");
 });
 it("RLS başka şirketin gönderim kaydını gizler; çapraz FK yazısını reddeder",async()=>{
  const f=await fixture(),g=await fixture(),{service}=kur();await service.taraTenant(f.tenantId);
  expect(await tx(g,t=>t.odemeSozuHatirlatma.findMany())).toHaveLength(0);
  await expect(tx(g,t=>t.odemeSozuHatirlatma.create({data:{tenantId:g.tenantId,sozId:f.sozId,alici:"a@example.invalid",konu:"Test"}}))).rejects.toThrow();
 });
});
