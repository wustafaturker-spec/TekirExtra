import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.F01_YARIS_DB_URL, dist = process.env.F02_API_DIST;
if (!url || !dist || !process.env.F01_YARIS_NONCE) throw new Error("F02_API_DIST=<aday/api> node scripts/f01-yaris-kabul.mjs --f02-yayin kullanın");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username !== "tekir_app" || ["5432", "5433"].includes(parsed.port)) throw new Error("Geçici DB kapsamı doğrulanamadı");
const req = createRequire(import.meta.url), load = (p: string) => req(resolve(dist, `${p}.js`));
load("ayar-tanimlari");
const { PrismaService } = load("core/prisma.service");
const { bosTutucuylaCalistir, baglamlaCalistir } = load("core/istek-baglami");
const { AuthGuard } = load("auth/auth.guard"), { RollerGuard } = load("auth/roller.guard");
const { OdemeSozuService } = load("cari/odeme-sozu.service"), { OdemeSozuController } = load("cari/odeme-sozu.controller");
const { TahsilatTakibiService } = load("cari/tahsilat-takibi.service"), { TahsilatTakibiController } = load("cari/tahsilat-takibi.controller");
const { AyarlarService } = load("core/ayarlar/ayarlar.service"), { AyarlarController } = load("core/ayarlar/ayarlar.controller");
const { GecikenSozZamanlayiciService } = load("cari/geciken-soz-zamanlayici.service");
const { NakitAkisiService } = load("nakit-akisi/nakit-akisi.service");
const db = new PrismaService({ datasourceUrl: url });
const soz = new OdemeSozuService(db), takip = new TahsilatTakibiService(db), ayarlar = new AyarlarService(db);
const jwt = new JwtService({ secret: randomBytes(32).toString("hex"), signOptions: { expiresIn: "5m" } });
@Module({ controllers: [OdemeSozuController, TahsilatTakibiController, AyarlarController], providers: [{ provide: OdemeSozuService, useValue: soz }, { provide: TahsilatTakibiService, useValue: takip }, { provide: AyarlarService, useValue: ayarlar }] }) class ReleaseModule {}
let app: any, base: string;
const gun = (n = 0) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const tarih = (n = 0) => new Date(`${gun(n)}T00:00:00Z`);
beforeAll(async () => {
  const [r] = await db.$queryRaw`SELECT current_database() AS db, current_setting('tekir.f01_yaris_nonce',true) AS marker,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
  expect(r).toEqual({ db: parsed.pathname.slice(1), marker: process.env.F01_YARIS_NONCE, rolsuper: false, rolbypassrls: false });
  app = await NestFactory.create(ReleaseModule, { logger: false }); app.setGlobalPrefix("api/v1");
  app.use((_req: unknown, _res: unknown, next: () => void) => bosTutucuylaCalistir(next));
  app.useGlobalGuards(new AuthGuard(jwt, new Reflector()), new RollerGuard(new Reflector()));
  await app.listen(0, "127.0.0.1"); base = `${await app.getUrl()}/api/v1`;
});
afterAll(async () => { await app?.close(); await db.$disconnect(); });
async function fixture(mod = "pilot") {
  const tenantId = randomUUID();
  return db.$transaction(async (t: any) => {
    await t.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
    await t.tenant.create({ data: { id: tenantId, vkn: tenantId, unvan: "F02 derlenmiş JWT provası" } });
    const u = await t.user.create({ data: { tenantId, adSoyad: "Prova yöneticisi", eposta: `${tenantId}@test.invalid`, parolaHash: "sentetik", rol: "yonetici" } });
    const c = await t.cariHesap.create({ data: { tenantId, kod: "C", unvan: "Prova carisi", tip: "musteri" } });
    const f = await t.fatura.create({ data: { tenantId, cariId: c.id, tip: "satis", durum: "kesin", tarih: tarih(-10), dovizCinsi: "TRY", kur: "1", toplamBrut: "2000", toplamMatrah: "2000", genelToplam: "2000", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0" } });
    await t.modulAyar.create({ data: { tenantId, modul: "tahsilat_operasyonu", ayarlar: { mod, surum: 1 } } });
    return { tenantId, userId: u.id, cariId: c.id, faturaId: f.id };
  });
}
const ctx = (f: any, fn: () => Promise<any>) => baglamlaCalistir({ ...f, rol: "yonetici" }, fn);
const token = (f: any, rol = "yonetici", extra = {}) => jwt.sign({ sub: f.userId, tenantId: f.tenantId, rol, ...extra });
const http = (path: string, auth?: string, body?: unknown, method = "GET") => fetch(`${base}${path}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const body = (f: any) => ({ cariId: f.cariId, faturaId: f.faturaId, tutar: "1000.00", dovizCinsi: "TRY", sozTarihi: gun(7), aciklama: "JWT ile onaylı yerel prova", istekAnahtari: randomUUID() });
describe("Derlenmiş F02 yayın adayı / gerçek JWT guard", () => {
  it("arama fonksiyonu boş search_path altında NULL ve Türkçe metinde çalışır", async () => {
    const result = await db.$transaction(async (t: any) => {
      await t.$executeRaw`SELECT set_config('search_path','',true)`;
      return t.$queryRaw`SELECT public.tekir_arama_normal(NULL) AS bos,public.tekir_arama_normal('Çığ Şişli Ürün') AS metin`;
    });
    expect(result).toEqual([{ bos: "", metin: "cig sisli urun" }]);
  });
  it("imzasız, bozuk, süresi dolmuş ve platform kapsamlı tokenları reddeder", async () => {
    const f = await fixture(), path = `/cari/odeme-sozleri?cariId=${f.cariId}`;
    for (const auth of [undefined, "bozuk", new JwtService({ secret: "farkli-test-anahtari" }).sign({ sub: f.userId, tenantId: f.tenantId, rol: "yonetici" }), jwt.sign({ sub: f.userId, tenantId: f.tenantId, rol: "yonetici" }, { expiresIn: -1 }), token(f, "yonetici", { kapsam: "platform" })]) expect((await http(path, auth)).status).toBe(401);
  });
  it("kimliği header ile değil JWT ile kurar ve no-store gerçek yanıtta vardır", async () => {
    const f = await fixture(), g = body(f), auth = token(f, "muhasebe");
    const post = await http("/cari/odeme-sozleri", auth, g, "POST"); expect(post.status).toBe(201);
    const s = await post.json(); expect(s).toMatchObject({ cariId: f.cariId, tutar: "1000.00" });
    expect(await (await http("/cari/odeme-sozleri", auth, g, "POST")).json()).toEqual(s);
    const get = await http(`/cari/odeme-sozleri?cariId=${f.cariId}`, auth); expect(get.status).toBe(200); expect(get.headers.get("cache-control")).toBe("no-store"); expect((await get.json()).sozler).toHaveLength(1);
    const forged = await fetch(`${base}/cari/odeme-sozleri`, { method: "POST", headers: { Authorization: `Bearer ${token(f,"satis")}`, "x-test-rol": "yonetici", "Content-Type": "application/json" }, body: JSON.stringify(body(f)) }); expect(forged.status).toBe(403);
  });
  it("diğer şirketin carisi/faturası JWT ve RLS kapsamında kalır", async () => {
    const a = await fixture(), b = await fixture();
    expect((await http(`/cari/odeme-sozleri?cariId=${a.cariId}`, token(b))).status).toBe(404);
    expect((await http("/cari/odeme-sozleri", token(b), { ...body(b), faturaId: a.faturaId }, "POST")).status).toBe(404);
  });
  it("okuma rollerini ve ayar yazma yetkisini gerçek controller metadata'sından uygular", async () => {
    const f = await fixture();
    for (const rol of ["yonetici", "muhasebe", "mali_musavir", "salt_okunur"]) expect((await http(`/cari/odeme-sozleri?cariId=${f.cariId}`, token(f, rol))).status).toBe(200);
    expect((await http(`/cari/odeme-sozleri?cariId=${f.cariId}`, token(f,"satis"))).status).toBe(403);
    expect((await http("/ayarlar/tahsilat_operasyonu", token(f,"muhasebe"), { mod: "acik" }, "PUT")).status).toBe(403);
    expect((await http("/ayarlar/tahsilat_operasyonu", token(f), { mod: "pilot" }, "PUT")).status).toBe(200);
  });
  it("kapalı/salt okunur moda geçiş eski tokenı yazma yetkisi yapmaz; finans ve geçmiş korunur", async () => {
    const f = await fixture(), auth = token(f);
    expect((await http("/cari/odeme-sozleri", auth, body(f), "POST")).status).toBe(201);
    await http("/ayarlar/tahsilat_operasyonu", auth, { mod: "salt_okunur" }, "PUT");
    expect((await http("/cari/odeme-sozleri", auth, body(f), "POST")).status).toBe(403);
    expect((await http(`/cari/odeme-sozleri?cariId=${f.cariId}`, auth)).status).toBe(200);
    await http("/ayarlar/tahsilat_operasyonu", auth, { mod: "kapali" }, "PUT");
    expect((await http(`/cari/odeme-sozleri?cariId=${f.cariId}`, auth)).status).toBe(403);
    const counts = await ctx(f, () => db.tenantIslem(f.tenantId, async (t: any) => [await t.odemeSozu.count(), await t.fatura.count(), await t.kasaBankaHareket.count()])); expect(counts).toEqual([1,1,0]);
  });
  it("derlenmiş worker geciken sözden bildirimli işi bir kez üretir; HTTP detay doğru kaydı okur", async () => {
    const f = await fixture(), auth = token(f);
    await ctx(f, () => db.tenantIslem(f.tenantId, (t: any) => t.odemeSozu.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, tutar: "1000", dovizCinsi: "TRY", sozTarihi: tarih(-1), verildigiZaman: new Date(Date.now() - 3 * 86400000), olusturanUserId: f.userId, aciklama: "Geçmiş doğal işlem simülasyonu", istekAnahtari: randomUUID(), girdiOzeti: "e".repeat(64) } })));
    expect((await http("/ayarlar/tahsilat_otomasyonu", auth, { acik: true, sorumluUserId: f.userId, uygulamaIciBildirim: true }, "PUT")).status).toBe(200);
    const worker = new GecikenSozZamanlayiciService(db, takip);
    expect(await worker.taraTenant(f.tenantId)).toMatchObject({ baglanan: 1, olusturulan: 1, hatali: 0 });
    expect(await worker.taraTenant(f.tenantId)).toMatchObject({ baglanan: 0, olusturulan: 0 });
    const jobs = await (await http("/cari/tahsilat-takipleri", auth)).json(); expect(jobs.kayitlar).toHaveLength(1);
    const detail = await http(`/cari/tahsilat-takipleri/${jobs.kayitlar[0].id}`, auth); expect(detail.status).toBe(200);
    const mails = await ctx(f, () => db.tenantIslem(f.tenantId, (t: any) => t.bildirimTeslimati.findMany())); expect(mails).toHaveLength(1); expect(mails[0].epostaDurumu).toBe("kapali");
  });
  it("derlenmiş nakit motoru aynı fatura alacağını söz payıyla çift saymaz", async () => {
    const f = await fixture(); await http("/cari/odeme-sozleri", token(f), body(f), "POST");
    const nakit = new NakitAkisiService(db, { kurlariGetir: () => { throw new Error("TRY fixture kur isteyemez"); } });
    const result = await ctx(f, () => nakit.tahmin(30));
    expect(result.kalemler.filter((p: any) => p.kaynakId === f.faturaId).reduce((sum: number, p: any) => sum + p.dovizTutar, 0)).toBe(2000);
    expect(result.kalemler.find((p: any) => p.odemeSozu)?.dovizTutar).toBe(1000);
  });
});
