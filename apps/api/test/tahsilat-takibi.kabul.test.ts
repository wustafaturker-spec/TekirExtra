import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";
import { afterAll, beforeAll, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";
import { RollerGuard } from "../src/auth/roller.guard";
import { TahsilatTakibiService } from "../src/cari/tahsilat-takibi.service";
import { TahsilatTakibiController } from "../src/cari/tahsilat-takibi.controller";
import { takipDetayiniDogrula, takipListesiniDogrula } from "../../web/src/lib/tahsilat-takibi";
const url = process.env.F01_YARIS_DB_URL;
if (!url || !process.env.F01_YARIS_NONCE) throw new Error("Geçici F02 runner'ını kullanın");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username !== "tekir_app" || ["5432", "5433"].includes(parsed.port)) throw new Error("Geçici DB kapsamı doğrulanamadı");
const a = new PrismaService({ datasourceUrl: url }), b = new PrismaService({ datasourceUrl: url });
const servis = new TahsilatTakibiService(a), servisB = new TahsilatTakibiService(b);
let app: INestApplication, base: string;
@Module({ controllers: [TahsilatTakibiController], providers: [{ provide: TahsilatTakibiService, useValue: servis }] }) class TestModule {}
beforeAll(async () => {
  const [r] = await a.$queryRaw<any[]>`SELECT current_database() AS db, current_setting('tekir.f01_yaris_nonce',true) AS marker, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  expect(r).toEqual({ db: parsed.pathname.slice(1), marker: process.env.F01_YARIS_NONCE, rolsuper: false, rolbypassrls: false });
  const rls = await a.$queryRaw<any[]>`SELECT relrowsecurity,relforcerowsecurity,relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner FROM pg_class WHERE relname IN ('tahsilat_takipleri','tahsilat_gorusmeleri')`;
  expect(rls).toHaveLength(2); expect(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity && !r.owner)).toBe(true);
  app = await NestFactory.create(TestModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => baglamlaCalistir({ tenantId: req.headers["x-tenant"], userId: req.headers["x-user"], rol: req.headers["x-rol"] }, async () => next()));
  app.useGlobalGuards(new RollerGuard(new Reflector())); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
afterAll(async () => { await app?.close(); await Promise.all([a.$disconnect(), b.$disconnect()]); });
async function fixture(mod: string | null = "pilot") {
  const tenantId = randomUUID(); return a.$transaction(async (t) => {
    await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
    await t.tenant.create({ data: { id: tenantId, vkn: tenantId, unvan: "F02 takip geçici kabul" } });
    const user = await t.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: "test", adSoyad: "Takip sorumlusu", rol: "yonetici" } });
    const cari = await t.cariHesap.create({ data: { tenantId, kod: "C", unvan: "Takip carisi", tip: "musteri" } });
    if (mod) await t.modulAyar.create({ data: { tenantId, modul: "tahsilat_operasyonu", ayarlar: { surum: 1, mod } } });
    return { tenantId, userId: user.id, cariId: cari.id };
  });
}
type F = Awaited<ReturnType<typeof fixture>>;
const ctx = <T>(f: F, is: () => Promise<T>, rol: Rol = "yonetici") => baglamlaCalistir({ ...f, rol }, is);
const tx = <T>(f: F, is: (t: Prisma.TransactionClient) => Promise<T>) => ctx(f, () => a.tenantIslem(f.tenantId, is));
const gun = (n = 0) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const body = (f: F) => ({ cariId: f.cariId, sorumluUserId: f.userId, konu: "Vadesi geçen alacak", neden: "tahsilat", sonrakiIslemTarihi: gun(), sonrakiIslem: "Telefonla ara", istekAnahtari: randomUUID() });
const yeni = (f: F, g = body(f)) => ctx(f, () => servis.olustur(g));
const not = (surum = 1) => ({ beklenenSurum: surum, kanal: "telefon", gorusmeTarihi: gun(), not: "Müşteriyle görüşüldü", istekAnahtari: randomUUID() });
const degis = (f: F, ek: Record<string, unknown> = {}) => ({ beklenenSurum: 1, sorumluUserId: f.userId, neden: "itiraz", durum: "beklemede", sonrakiIslemTarihi: gun(1), sonrakiIslem: "Belgeyi kontrol et", gerekce: "Müşteri faturaya itiraz etti", ...ek });
const finans = (f: F) => tx(f, async (t) => JSON.stringify([await t.fatura.findMany(), await t.cariHareket.findMany(), await t.kasaBankaHareket.findMany(), await t.faturaKapama.findMany()]));

it("takip oluşturma tekrarı tek kayıt/audit üretir ve mali kayıtlara yazmaz", async () => {
  const f = await fixture(), g = body(f), once = await finans(f), s = await yeni(f, g);
  expect(await yeni(f, g)).toEqual(s); expect(s).toMatchObject({ durum: "acik", surum: 1, sorumlu: { id: f.userId } });
  await expect(yeni(f, { ...g, konu: "Farklı konu" })).rejects.toMatchObject({ status: 409 });
  expect(await finans(f)).toBe(once); expect(await tx(f, (t) => t.tahsilatTakibi.count())).toBe(1);
  expect((await ctx(f, () => servis.getir(s.id))).olaySayisi).toBe(1);
  expect(takipDetayiniDogrula(await ctx(f,()=>servis.getir(s.id)),s.id,f.cariId).kayit.id).toBe(s.id);
  expect(takipListesiniDogrula(await ctx(f,()=>servis.listele({})),{gorunum:"bugun"}).kayitlar[0].id).toBe(s.id);
});
it("iki bağlantıda aynı istek tek takip oluşturur; başka anahtar ikinci açık takip açamaz", async () => {
  const f = await fixture(), g = body(f);
  const [a1,b1] = await Promise.all([yeni(f,g), ctx(f, () => servisB.olustur(g))]); expect(a1.id).toBe(b1.id);
  await expect(yeni(f)).rejects.toMatchObject({ status: 409 });
});
it("görüşme tekrarında bir kayıt ve bir sürüm artışı olur; not değiştirilemez/silinemez", async () => {
  const f = await fixture(), s = await yeni(f), g = not();
  const n = await ctx(f, () => servis.gorusmeEkle(s.id,g)); expect(n.kayit.surum).toBe(2);
  expect(await ctx(f, () => servis.gorusmeEkle(s.id,g))).toEqual(n);
  const d = await ctx(f, () => servis.getir(s.id)); expect(d.gorusmeSayisi).toBe(1); expect(d.gorusmeler[0].not).toBe(g.not);
  await expect(tx(f, (t) => t.tahsilatGorusmesi.update({ where: { id: n.gorusmeId }, data: { not: "Değiştir" } }))).rejects.toThrow();
  await expect(tx(f, (t) => t.tahsilatGorusmesi.delete({ where: { id: n.gorusmeId } }))).rejects.toThrow();
});
it("görüşme ile kapatma yarışında yalnız bir eski sürüm işlemi başarılı olur", async () => {
  const f = await fixture(), s = await yeni(f);
  const sonuclar = await Promise.allSettled([ctx(f, () => servis.gorusmeEkle(s.id,not())), ctx(f, () => servisB.guncelle(s.id,degis(f,{ durum: "tamamlandi", sonrakiIslem: null, sonrakiIslemTarihi: null })))]);
  expect(sonuclar.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((sonuclar.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(409);
});
it("itiraz/sorumlu/tarih değişir; tamamlanan takip yeniden açılamaz ama yeni takip açılabilir", async () => {
  const f = await fixture(), s = await yeni(f);
  const u = await ctx(f, () => servis.guncelle(s.id,degis(f))); expect(u).toMatchObject({ neden: "itiraz", durum: "beklemede", surum: 2 });
  await ctx(f, () => servis.guncelle(s.id,degis(f,{ beklenenSurum: 2, durum: "tamamlandi", sonrakiIslem: null, sonrakiIslemTarihi: null })));
  await expect(ctx(f, () => servis.gorusmeEkle(s.id,not(3)))).rejects.toMatchObject({ status: 409 });
  await expect(ctx(f, () => servis.guncelle(s.id,degis(f,{ beklenenSurum: 3 })))).rejects.toMatchObject({ status: 409 });
  const s2 = await yeni(f); expect(s2.id).not.toBe(s.id); expect(await tx(f, (t) => t.tahsilatTakibi.count())).toBe(2);
});
it("audit hatası notu ve sürüm artışını birlikte geri alır", async () => {
  const f = await fixture(), s = await yeni(f);
  const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => a.tenantIslem(tenantId, (t) => is(new Proxy(t,{ get(target,key) { return key === "auditLog" ? { create: async () => { throw new Error("Sentetik audit hatası"); } } : Reflect.get(target,key); } }))) };
  await expect(ctx(f, () => new TahsilatTakibiService(adapter as unknown as PrismaService).gorusmeEkle(s.id,not()))).rejects.toThrow("Sentetik audit");
  const d = await ctx(f, () => servis.getir(s.id)); expect(d.gorusmeSayisi).toBe(0); expect(d.kayit.surum).toBe(1);
});
it("bugün/gelecek/itiraz filtreleri ve sorumlu seçimi doğru kapsamı döndürür", async () => {
  const f = await fixture(), s = await yeni(f);
  expect((await ctx(f, () => servis.listele({}))).kayitlar[0].id).toBe(s.id);
  await ctx(f, () => servis.guncelle(s.id,degis(f)));
  expect((await ctx(f, () => servis.listele({}))).toplam).toBe(0);
  expect((await ctx(f, () => servis.listele({ gorunum: "itiraz" }))).toplam).toBe(1);
  expect((await ctx(f, () => servis.listele({ gorunum: "tum", sorumluUserId: randomUUID() }))).toplam).toBe(0);
});
it("51 takip cursor sayfalaması tekrar/kayıp üretmez ve yabancı imleç 409 olur", async () => {
  const f = await fixture();
  await tx(f, async (t) => {
    for (let i=0;i<51;i++) {
      const c = await t.cariHesap.create({ data: { tenantId:f.tenantId,kod:`C${i}`,unvan:`Takip ${i}`,tip:"musteri" } });
      await t.tahsilatTakibi.create({ data: { ...body(f), tenantId:f.tenantId,cariId:c.id,olusturanUserId:f.userId,sonrakiIslemTarihi:new Date(gun()),girdiOzeti:"a".repeat(64) } });
    }
  });
  const p1 = await ctx(f, () => servis.listele({})), p2 = await ctx(f, () => servis.listele({ imlec:p1.sonrakiImlec }));
  expect(p1.kayitlar).toHaveLength(50); expect(p2.kayitlar).toHaveLength(1); expect(new Set([...p1.kayitlar,...p2.kayitlar].map((s)=>s.id)).size).toBe(51);
  await expect(ctx(f, () => servis.listele({ imlec:randomUUID() }))).rejects.toMatchObject({ status:409 });
});
it("yabancı cari/atanan/kayıt/görüşme RLS ve DB kapsamıyla reddedilir", async () => {
  const f = await fixture(), other = await fixture(), s = await yeni(f);
  expect(await a.tahsilatTakibi.findMany()).toEqual([]); expect(await tx(other, (t) => t.tahsilatTakibi.findMany())).toEqual([]);
  await expect(ctx(other, () => servis.getir(s.id))).rejects.toMatchObject({ status:404 });
  await expect(yeni(other,{...body(other),cariId:f.cariId})).rejects.toMatchObject({status:404});
  await expect(yeni(other,{...body(other),sorumluUserId:f.userId})).rejects.toMatchObject({status:400});
  await expect(tx(other,(t)=>t.tahsilatGorusmesi.create({data:{tenantId:other.tenantId,takipId:s.id,userId:other.userId,kanal:"not",gorusmeTarihi:new Date(gun()),not:"Yabancı not",istekAnahtari:randomUUID(),girdiOzeti:"b".repeat(64)}}))).rejects.toThrow();
});
it.each(["salt_okunur","mali_musavir","satis","calisan"] as Rol[])("%s serviste yazamaz",async(rol)=>{const f=await fixture();await expect(ctx(f,()=>servis.olustur(body(f)),rol)).rejects.toMatchObject({status:403});});
it.each([null,"kapali","salt_okunur"])("%s şirket modunda yönetici yazamaz",async(mod)=>{const f=await fixture(mod);await expect(yeni(f)).rejects.toMatchObject({status:403});});
it("pasif/finans dışı sorumlu atanamaz; başlangıç kimliği ve kapalı kayıt DB'de korunur",async()=>{
 const f=await fixture();await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:false}}));await expect(yeni(f)).rejects.toMatchObject({status:400});
 await tx(f,t=>t.user.update({where:{id:f.userId},data:{aktif:true}}));const s=await yeni(f);
 await expect(tx(f,t=>t.tahsilatTakibi.update({where:{id:s.id},data:{konu:"Değiştir",surum:2}}))).rejects.toThrow();
 await expect(tx(f,t=>t.tahsilatTakibi.delete({where:{id:s.id}}))).rejects.toThrow();
});
it("gelecek görüşme ve geçmiş sonraki işlem reddedilir",async()=>{
 const f=await fixture();await expect(yeni(f,{...body(f),sonrakiIslemTarihi:gun(-1)})).rejects.toMatchObject({status:400});const s=await yeni(f);
 await expect(ctx(f,()=>servis.gorusmeEkle(s.id,{...not(),gorusmeTarihi:gun(1)}))).rejects.toMatchObject({status:400});
});
it("HTTP gerçek controller/guard, no-store ve salt okunur sınırlarını uygular",async()=>{
 const f=await fixture(),headers={"x-tenant":f.tenantId,"x-user":f.userId,"x-rol":"muhasebe","Content-Type":"application/json"};
 const r=await fetch(`${base}/cari/tahsilat-takipleri`,{method:"POST",headers,body:JSON.stringify(body(f))});expect(r.status).toBe(201);const s=await r.json();
 const get=await fetch(`${base}/cari/tahsilat-takipleri?cariId=${f.cariId}&gorunum=tum`,{headers});expect(get.status).toBe(200);expect(get.headers.get("cache-control")).toBe("no-store");expect((await get.json()).kayitlar[0].id).toBe(s.id);
 expect((await fetch(`${base}/cari/tahsilat-takipleri/${s.id}/gorusmeler`,{method:"POST",headers:{...headers,"x-rol":"salt_okunur"},body:JSON.stringify(not())})).status).toBe(403);
});
