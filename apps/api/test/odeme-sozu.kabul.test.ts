import "reflect-metadata";
import "../src/ayar-tanimlari";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { RollerGuard } from "../src/auth/roller.guard";
import { OdemeSozuService } from "../src/cari/odeme-sozu.service";
import { OdemeSozuController } from "../src/cari/odeme-sozu.controller";
import { nakitSozleriniOku } from "../src/nakit-akisi/nakit-sozu-kaynak";
import { NakitAkisiService } from "../src/nakit-akisi/nakit-akisi.service";
import { TahsilatTakibiService } from "../src/cari/tahsilat-takibi.service";
import { GecikenSozZamanlayiciService } from "../src/cari/geciken-soz-zamanlayici.service";
import { AyarlarService } from "../src/core/ayarlar/ayarlar.service";
import { BildirimService } from "../src/bildirimler/bildirim.service";
import { BildirimEpostaService } from "../src/bildirimler/bildirim-eposta.service";
import { VadeHatirlatmaService } from "../src/cari/vade-hatirlatma.service";
import type { Rol } from "@tekirextra/shared";
import { odemeSozuListesiniDogrula } from "../../web/src/lib/odeme-sozu";

const url = process.env.F01_YARIS_DB_URL;
if (!url || !process.env.F01_YARIS_NONCE) throw new Error("node scripts/f01-yaris-kabul.mjs --f02 kullanın");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || !/^\/f01_yaris_[a-f0-9]{16}$/.test(parsed.pathname) || parsed.username !== "tekir_app" || ["5432", "5433"].includes(parsed.port)) throw new Error("Geçici DB kapsamı doğrulanamadı");
const a = new PrismaService({ datasourceUrl: url }), b = new PrismaService({ datasourceUrl: url });
const servis = new OdemeSozuService(a), servisB = new OdemeSozuService(b);
const D = (v: string) => new Prisma.Decimal(v);
const gun = (fark: number) => new Date(Date.now() + fark * 86400000).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const tarih = (fark: number) => new Date(`${gun(fark)}T00:00:00Z`);
let app: INestApplication, base: string;
@Module({ controllers: [OdemeSozuController], providers: [{ provide: OdemeSozuService, useValue: servis }] })
class TestModule {}

beforeAll(async () => {
  const [guard] = await a.$queryRaw<any[]>`SELECT current_database() AS db, current_setting('tekir.f01_yaris_nonce', true) AS marker, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  expect(guard).toEqual({ db: parsed.pathname.slice(1), marker: process.env.F01_YARIS_NONCE, rolsuper: false, rolbypassrls: false });
  const [rls] = await a.$queryRaw<any[]>`SELECT relrowsecurity, relforcerowsecurity, relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owner FROM pg_class WHERE relname = 'odeme_sozleri'`;
  expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true, owner: false });
  app = await NestFactory.create(TestModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => baglamlaCalistir({ tenantId: req.headers["x-test-tenant"], userId: req.headers["x-test-user"], rol: req.headers["x-test-rol"] }, async () => next()));
  app.useGlobalGuards(new RollerGuard(new Reflector()));
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
afterAll(async () => { await app?.close(); await Promise.all([a.$disconnect(), b.$disconnect()]); });

async function fixture(mod: string | null = "pilot") {
  const tenantId = randomUUID();
  return a.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.tenant.create({ data: { id: tenantId, vkn: tenantId, unvan: "F02 geçici test" } });
    const user = await tx.user.create({ data: { tenantId, eposta: `${tenantId}@test.local`, parolaHash: "test", adSoyad: "F02", rol: "yonetici" } });
    const cari = await tx.cariHesap.create({ data: { tenantId, kod: "C", unvan: "Tahsilat", tip: "musteri" } });
    const fatura = await tx.fatura.create({ data: { tenantId, cariId: cari.id, tip: "satis", durum: "kesin", tarih: tarih(-10), dovizCinsi: "TRY", kur: "1", toplamBrut: "2000", toplamMatrah: "2000", genelToplam: "2000", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0" } });
    if (mod) await tx.modulAyar.create({ data: { tenantId, modul: "tahsilat_operasyonu", ayarlar: { surum: 1, mod } } });
    return { tenantId, userId: user.id, cariId: cari.id, faturaId: fatura.id };
  });
}
type F = Awaited<ReturnType<typeof fixture>>;
const baglam = <T>(f: F, is: () => Promise<T>, rol: Rol = "yonetici") => baglamlaCalistir({ tenantId: f.tenantId, userId: f.userId, rol }, is);
const tx = <T>(f: F, is: (t: Prisma.TransactionClient) => Promise<T>) => baglam(f, () => a.tenantIslem(f.tenantId, is));
const govde = (f: F) => ({ cariId: f.cariId, faturaId: f.faturaId, dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: gun(7), aciklama: "Telefon görüşmesinde ödeme sözü", istekAnahtari: randomUUID() });
const liste = (f: F) => baglam(f, () => servis.listele({ cariId: f.cariId }));
const olustur = (f: F, g = govde(f)) => baglam(f, () => servis.olustur(g));
const nakit = (f: F) => baglam(f, () => new NakitAkisiService(a, { kurlariGetir: () => { throw new Error("TRY için kur çağrılmamalı"); } } as never).tahmin(30));
const finans = (f: F) => tx(f, async (t) => JSON.stringify({ faturalar: await t.fatura.findMany(), kapamalar: await t.faturaKapama.findMany(), hareketler: await t.kasaBankaHareket.findMany(), cari: await t.cariHareket.findMany() }));
async function eskiSoz(f: F) {
  return tx(f, (t) => t.odemeSozu.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, dovizCinsi: "TRY", tutar: "1000", sozTarihi: tarih(7), verildigiZaman: new Date(Date.now() - 3 * 86400000), olusturanUserId: f.userId, aciklama: "Geçmiş söz", istekAnahtari: randomUUID(), girdiOzeti: "a".repeat(64) } }));
}
async function odeme(f: F, tutar = "400", fark = -1) {
  return tx(f, async (t) => {
    const h = await t.kasaBankaHareket.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "tahsilat", tutar, dovizCinsi: "TRY", kur: "1", tutarTry: tutar, tarih: tarih(fark), createdAt: new Date(Date.now() + fark * 86400000), kaynakTur: "manuel" } });
    const k = await t.faturaKapama.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, tutar, kasaBankaHareketId: h.id, otomatik: true } });
    return { h, k };
  });
}

const takipServisi = new TahsilatTakibiService(a);
const tarayici = new GecikenSozZamanlayiciService(a, takipServisi);
const otomasyonAc = (f: F) => baglam(f, () => new AyarlarService(a).guncelle("tahsilat_otomasyonu", { acik: true, sorumluUserId: f.userId }));
const geciken = (f: F, fark = -1) => tx(f, (t) => t.odemeSozu.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, dovizCinsi: "TRY", tutar: "1000", sozTarihi: tarih(fark), verildigiZaman: new Date(Date.now() - 4 * 86400000), olusturanUserId: f.userId, aciklama: "Geciken söz", istekAnahtari: randomUUID(), girdiOzeti: "d".repeat(64) } }));
const takipSayilari = (f: F) => tx(f, async (t) => ({ takip: await t.tahsilatTakibi.count(), bag: await t.tahsilatSozBaglantisi.count(), audit: await t.auditLog.count({ where: { varlik: "tahsilat_takibi" } }) }));
const elleTakip = (f: F) => baglam(f, () => takipServisi.olustur({ cariId: f.cariId, sorumluUserId: f.userId, konu: "Mevcut itiraz", neden: "itiraz", sonrakiIslemTarihi: gun(7), sonrakiIslem: "İtirazı incele", istekAnahtari: randomUUID() }));
const kapat = (f: F, id: string, surum: number) => baglam(f, () => takipServisi.guncelle(id, { beklenenSurum: surum, sorumluUserId: f.userId, neden: "tahsilat", durum: "tamamlandi", sonrakiIslemTarihi: null, sonrakiIslem: null, gerekce: "İnceleme tamamlandı" }));

const bildirimler = new BildirimService(a);
const bildirimAc = (f: F) => baglam(f, () => new AyarlarService(a).guncelle("tahsilat_otomasyonu", { acik: true, sorumluUserId: f.userId, uygulamaIciBildirim: true }));
const bildirimListesi = (f: F, rol: Rol = "yonetici") => baglam(f, () => bildirimler.listele({ kapsam: "bana", sayfa: 1, limit: 100 }), rol);
async function borcluCari(f: F) {
  await tx(f, async (t) => {
    await t.cariHesap.update({ where: { id: f.cariId }, data: { eposta: "test@example.invalid" } });
    await t.cariHareket.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "borc", tutar: "2000", tutarTry: "2000", tarih: tarih(-10), vadeTarihi: tarih(-7), aciklama: "Geçici kabul borcu" } });
  });
}
function hatirlatmaKur(pdf?: () => Promise<void>) {
  let gonderimler = 0;
  const servis = new VadeHatirlatmaService(a, { ekliIletiGonder: async () => { gonderimler++; } } as never, { ekstrePdf: async () => { await pdf?.(); return Buffer.from("sentetik-pdf"); } } as never);
  return { servis, say: () => gonderimler };
}
describe("F02 kontrollü uygulama içi bildirim ve itiraz iletişimi", () => {
  it("aynı takibe bir bildirim/teslimat açar; e-posta tercihi açık olsa da e-posta kuyruğu açmaz", async () => {
    const f = await fixture(); await geciken(f); await bildirimAc(f);
    const diger = new GecikenSozZamanlayiciService(b, new TahsilatTakibiService(b));
    await Promise.all([tarayici.taraTenant(f.tenantId), diger.taraTenant(f.tenantId)]);
    await tarayici.taraTenant(f.tenantId);
    const liste = await bildirimListesi(f); expect(liste.toplam).toBe(1);
    expect(liste.kayitlar[0]).toMatchObject({ userId: f.userId, epostaDurumu: "kapali", bildirim: { kaynakTur: "tahsilat_takibi" } });
    expect(liste.kayitlar[0].bildirim.hedefYol).toBe(`/panel/cari/tahsilat?takip=${liste.kayitlar[0].bildirim.kaynakRef}`);
    let mailler = 0;
    expect(await baglam(f, () => new BildirimEpostaService(a, { iletiGonder: async () => { mailler++; } } as never).bekleyenleriGonder())).toMatchObject({ gonderilen: 0 });
    expect(mailler).toBe(0);
  });
  it("varsayılan kapalıdır; vade uygulama içi tercihi kapalıysa e-posta ile telafi etmez", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f); await tarayici.taraTenant(f.tenantId);
    expect((await bildirimListesi(f)).toplam).toBe(0);
    const diger = await fixture(); await geciken(diger); await bildirimAc(diger);
    await baglam(diger, () => bildirimler.tercihKaydet({ tur: "vade", uygulamaIci: false, eposta: true }));
    await tarayici.taraTenant(diger.tenantId); expect((await bildirimListesi(diger)).toplam).toBe(0);
  });
  it("şirket modu kapanınca veya güncel rol düşünce eski bildirimi liste/sayaç/aksiyondan gizler", async () => {
    const f = await fixture(); await geciken(f); await bildirimAc(f); await tarayici.taraTenant(f.tenantId);
    const [d] = (await bildirimListesi(f)).kayitlar;
    await tx(f, (t) => t.modulAyar.update({ where: { tenantId_modul: { tenantId: f.tenantId, modul: "tahsilat_operasyonu" } }, data: { ayarlar: { mod: "kapali" } } }));
    expect((await bildirimListesi(f)).toplam).toBe(0); expect(await baglam(f, () => bildirimler.ozet())).toMatchObject({ okunmamis: 0 });
    await expect(baglam(f, () => bildirimler.ustlen(d.id))).rejects.toMatchObject({ status: 404 });
    await tx(f, (t) => t.modulAyar.update({ where: { tenantId_modul: { tenantId: f.tenantId, modul: "tahsilat_operasyonu" } }, data: { ayarlar: { mod: "pilot" } } }));
    await tx(f, (t) => t.user.update({ where: { id: f.userId }, data: { rol: "muhasebe" } }));
    expect((await bildirimListesi(f)).toplam).toBe(1);
    expect((await baglam(f, () => bildirimler.listele({ kapsam: "firma", sayfa: 1, limit: 100 }))).toplam).toBe(0);
    await tx(f, (t) => t.user.update({ where: { id: f.userId }, data: { rol: "satis" } }));
    expect((await bildirimListesi(f)).toplam).toBe(0); // Eski JWT'deki yönetici rolü dahi yetmez.
    expect((await bildirimListesi(f, "satis")).toplam).toBe(0);
    await expect(baglam(f, () => bildirimler.aksiyonAlindi(d.id))).rejects.toMatchObject({ status: 404 });
  });
  it("takip tamamlanınca bildirimi kapatır, geçmiş kaydı korur", async () => {
    const f = await fixture(); await geciken(f); await bildirimAc(f); await tarayici.taraTenant(f.tenantId);
    const s = (await baglam(f, () => takipServisi.listele({}))).kayitlar[0];
    await kapat(f, s.id, s.surum); expect((await bildirimListesi(f)).toplam).toBe(0);
    expect((await baglam(f, () => bildirimler.listele({ kapsam: "bana", sayfa: 1, limit: 100, kapanmis: "true" }))).toplam).toBe(1);
  });
  it("sorumlu değişiminde geçmiş teslimatı yoksayılır; yeni sorumluya yalnız uygulama içi teslimat açılır", async () => {
    const f = await fixture(); await geciken(f); await bildirimAc(f); await tarayici.taraTenant(f.tenantId);
    const s = (await baglam(f, () => takipServisi.listele({}))).kayitlar[0];
    const user = await tx(f, (t) => t.user.create({ data: { tenantId: f.tenantId, eposta: `${randomUUID()}@test.local`, parolaHash: "test", adSoyad: "Yeni sorumlu", rol: "muhasebe" } }));
    await baglam(f, () => takipServisi.guncelle(s.id, { beklenenSurum: s.surum, sorumluUserId: user.id, neden: "tahsilat", durum: "acik", sonrakiIslemTarihi: gun(1), sonrakiIslem: "Araştır", gerekce: "Sorumlu değişikliği" }));
    const teslimatlar = await tx(f, (t) => t.bildirimTeslimati.findMany());
    expect(teslimatlar).toHaveLength(2); expect(teslimatlar.find((d) => d.userId === f.userId)?.durum).toBe("yoksayildi");
    expect(teslimatlar.find((d) => d.userId === user.id)).toMatchObject({ durum: "yeni", epostaDurumu: "kapali" });
  });
  it("bildirim yazımı başarısızsa söz bağı, takip, audit ve bildirim birlikte geri alınır", async () => {
    const f = await fixture(); await geciken(f); await bildirimAc(f);
    const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => a.tenantIslem(tenantId, (t) => is(new Proxy(t, { get(target, key) {
      if (key === "bildirimTeslimati") return { createMany: async () => { throw new Error("Sentetik bildirim hatası"); } };
      return Reflect.get(target, key);
    } }))) };
    await expect(baglam(f, () => new TahsilatTakibiService(adapter as never).gecikenSozleriBagla(f.cariId))).rejects.toThrow("Sentetik bildirim");
    expect(await takipSayilari(f)).toEqual({ takip: 0, bag: 0, audit: 0 }); expect((await bildirimListesi(f)).toplam).toBe(0);
    expect(await tx(f, (t) => t.bildirim.count())).toBe(0);
  });
  it("açık itiraz aday/önizleme/toplu gönderimde engeldir; sıklık aşımı ve kapalı mod atlatamaz", async () => {
    const f = await fixture(); await borcluCari(f); await elleTakip(f);
    const { servis: h, say } = hatirlatmaKur();
    expect((await baglam(f, () => h.adaylar()))[0]).toMatchObject({ itirazEngeli: true });
    await expect(baglam(f, () => h.onizle(f.cariId, "hatirlatma"))).rejects.toMatchObject({ status: 409 });
    await tx(f, (t) => t.modulAyar.update({ where: { tenantId_modul: { tenantId: f.tenantId, modul: "tahsilat_operasyonu" } }, data: { ayarlar: { mod: "kapali" } } }));
    const r = await baglam(f, () => h.gonder({ cariIdler: [f.cariId], kademe: "ihtar", siklikSiniriniAs: true }));
    expect(r[0]).toMatchObject({ durum: "hata" }); expect(r[0].mesaj).toContain("açık tahsilat itirazı"); expect(say()).toBe(0);
  });
  it("PDF üretilirken açılan itirazı son kontrolde yakalar; diğer carinin iletisini engellemez", async () => {
    const f = await fixture(); await borcluCari(f);
    const { servis: h, say } = hatirlatmaKur(async () => { await elleTakip(f); });
    expect((await baglam(f, () => h.gonder({ cariIdler: [f.cariId], kademe: "hatirlatma" })))[0].durum).toBe("hata"); expect(say()).toBe(0);
    const diger = await fixture(); await borcluCari(diger); const temiz = hatirlatmaKur();
    expect((await baglam(diger, () => temiz.servis.gonder({ cariIdler: [diger.cariId], kademe: "hatirlatma" })))[0].durum).toBe("gonderildi"); expect(temiz.say()).toBe(1);
  });
});

describe("F02 geciken sözlerden otomatik takip", () => {
  it("varsayılan kapalıdır; finans ve operasyon kaydı üretmez", async () => {
    const f = await fixture(); await geciken(f);
    expect(await tarayici.taraTenant(f.tenantId)).toEqual({ baglanan: 0, olusturulan: 0, hatali: 0 });
    expect(await takipSayilari(f)).toEqual({ takip: 0, bag: 0, audit: 0 });
  });
  it("aktif sorumlu adına tek takip/bağ açar; tekrarda aynı söz yeni iş üretmez", async () => {
    const f = await fixture(), s = await geciken(f); await otomasyonAc(f); await odeme(f, "400");
    const once = await finans(f);
    expect(await tarayici.taraTenant(f.tenantId)).toEqual({ baglanan: 1, olusturulan: 1, hatali: 0 });
    expect(await tarayici.taraTenant(f.tenantId)).toEqual({ baglanan: 0, olusturulan: 0, hatali: 0 });
    expect(await takipSayilari(f)).toEqual({ takip: 1, bag: 1, audit: 2 });
    expect(await tx(f, (t) => t.tahsilatSozBaglantisi.findUnique({ where: { sozId: s.id } }))).toMatchObject({ userId: f.userId, kalan: D("600") });
    expect(await finans(f)).toBe(once);
    const liste = await baglam(f, () => takipServisi.listele({}));
    expect(liste.kayitlar[0]).toMatchObject({ konu: "Geciken ödeme sözü takibi", sonrakiIslemTarihi: gun(0), sorumlu: { id: f.userId } });
    const detay = await baglam(f, () => takipServisi.getir(liste.kayitlar[0].id));
    expect(detay.olaylar.some((o) => o.aciklama.includes(s.id) && o.aciklama.includes("600.00 TRY"))).toBe(true);
  });
  it("iki worker yarışı bir takip, bağ ve audit üretir", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f);
    const diger = new GecikenSozZamanlayiciService(b, new TahsilatTakibiService(b));
    const sonuc = await Promise.all([tarayici.taraTenant(f.tenantId), diger.taraTenant(f.tenantId)]);
    expect(sonuc.reduce((t, s) => t + s.baglanan, 0)).toBe(1);
    expect(await takipSayilari(f)).toEqual({ takip: 1, bag: 1, audit: 2 });
  });
  it("aynı carinin iki farklı faturasındaki gecikmeler tek takibe bağlanır", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f);
    const ikinci = await tx(f, (t) => t.fatura.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "satis", durum: "kesin", tarih: tarih(-10), dovizCinsi: "TRY", kur: "1", toplamBrut: "2000", toplamMatrah: "2000", genelToplam: "2000", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0" } }));
    await geciken({ ...f, faturaId: ikinci.id });
    expect(await tarayici.taraTenant(f.tenantId)).toEqual({ baglanan: 2, olusturulan: 1, hatali: 0 });
    expect(await takipSayilari(f)).toEqual({ takip: 1, bag: 2, audit: 3 });
  });
  it("aday keşfinden sonra otomasyon kapanırsa eldeki adaydan iş yazmaz", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f);
    const arayaGiren = { gecikenSozleriBagla: async (cariId: string) => {
      await tx(f, (t) => t.modulAyar.update({ where: { tenantId_modul: { tenantId: f.tenantId, modul: "tahsilat_otomasyonu" } }, data: { ayarlar: { acik: false, sorumluUserId: f.userId } } }));
      return takipServisi.gecikenSozleriBagla(cariId);
    } };
    expect((await new GecikenSozZamanlayiciService(a, arayaGiren as never).taraTenant(f.tenantId)).baglanan).toBe(0);
    expect(await takipSayilari(f)).toEqual({ takip: 0, bag: 0, audit: 0 });
  });
  it("açık itirazın tarihini, sorumlusunu ve nedenini korur; eski sürümü reddeder", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f); const eski = await elleTakip(f);
    expect((await tarayici.taraTenant(f.tenantId)).olusturulan).toBe(0);
    const guncel = await baglam(f, () => takipServisi.getir(eski.id));
    expect(guncel.kayit).toMatchObject({ neden: "itiraz", sonrakiIslemTarihi: eski.sonrakiIslemTarihi, sorumlu: eski.sorumlu, surum: 2 });
    await expect(kapat(f, eski.id, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("bağlanmış söz kapalı takibi yeniden açmaz; ödeme geri alma da tekrar iş üretmez", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f); const { k } = await odeme(f, "400");
    await tarayici.taraTenant(f.tenantId);
    const s = (await baglam(f, () => takipServisi.listele({}))).kayitlar[0]; await kapat(f, s.id, s.surum);
    await tx(f, (t) => t.faturaKapama.delete({ where: { id: k.id } }));
    expect((await tarayici.taraTenant(f.tenantId)).baglanan).toBe(0);
    expect(await takipSayilari(f)).toMatchObject({ takip: 1, bag: 1 });
  });
  it("daha önce kapatılmış manuel takibin yanına yeni gecikme için yeni takip açabilir", async () => {
    const f = await fixture(); const eski = await elleTakip(f); await kapat(f, eski.id, eski.surum);
    await geciken(f); await otomasyonAc(f);
    expect((await tarayici.taraTenant(f.tenantId)).olusturulan).toBe(1);
    expect(await takipSayilari(f)).toMatchObject({ takip: 2, bag: 1 });
  });
  it.each([0, 1])("bugün/gelecek gün sözünden iş açmaz (%s)", async (fark) => {
    const f = await fixture(); await geciken(f, fark); await otomasyonAc(f);
    expect((await tarayici.taraTenant(f.tenantId)).baglanan).toBe(0);
  });
  it("eski ödeme söz gerçekleşmesi olmasa da fatura kapanmışsa iş açmaz", async () => {
    const f = await fixture(); await geciken(f); await odeme(f, "2000", -5); await otomasyonAc(f);
    expect((await tarayici.taraTenant(f.tenantId)).baglanan).toBe(0);
  });
  it("gerçekleşmiş veya iptal edilmiş sözden iş açmaz", async () => {
    const f = await fixture(); await geciken(f); await odeme(f, "1000", -1); await otomasyonAc(f);
    expect((await tarayici.taraTenant(f.tenantId)).baglanan).toBe(0);
    const diger = await fixture(), s = await geciken(diger); await otomasyonAc(diger);
    await baglam(diger, () => servis.iptal(s.id, { beklenenSurum: 1, gerekce: "İptal edildi" }));
    expect((await tarayici.taraTenant(diger.tenantId)).baglanan).toBe(0);
  });
  it.each(["kapali", "salt_okunur"])("tahsilat modu %s iken otomasyon açık olsa da yazmaz", async (mod) => {
    const f = await fixture(mod); await geciken(f); await otomasyonAc(f);
    expect((await tarayici.taraTenant(f.tenantId)).baglanan).toBe(0);
  });
  it("pasif veya rolü değişen sorumlu yerine sistem kimliğiyle yazmaz", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f);
    await tx(f, (t) => t.user.update({ where: { id: f.userId }, data: { aktif: false } }));
    await expect(tarayici.taraTenant(f.tenantId)).rejects.toThrow("uygun değil");
    expect(await takipSayilari(f)).toEqual({ takip: 0, bag: 0, audit: 0 });
    await tx(f, (t) => t.user.update({ where: { id: f.userId }, data: { aktif: true, rol: "satis" } }));
    await expect(tarayici.taraTenant(f.tenantId)).rejects.toThrow("uygun değil");
  });
  it("ayar kaydında başka tenant sorumlusu reddedilir ve audit yazılmaz", async () => {
    const f = await fixture(), diger = await fixture();
    await expect(baglam(f, () => new AyarlarService(a).guncelle("tahsilat_otomasyonu", { acik: true, sorumluUserId: diger.userId }))).rejects.toMatchObject({ status: 400 });
    expect(await tx(f, (t) => t.modulAyar.count({ where: { modul: "tahsilat_otomasyonu" } }))).toBe(0);
  });
  it("audit hatası takip, bağ ve sürümü birlikte geri alır", async () => {
    const f = await fixture(); await geciken(f); await otomasyonAc(f);
    const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => a.tenantIslem(tenantId, (t) => is(new Proxy(t, { get(target, key) {
      if (key === "auditLog") return { create: async (args: any) => { if (args.data.islem === "geciken_soz_takibe_baglandi") throw new Error("Sentetik bağ audit hatası"); return t.auditLog.create(args); } };
      return Reflect.get(target, key);
    } }))) };
    await expect(baglam(f, () => new TahsilatTakibiService(adapter as never).gecikenSozleriBagla(f.cariId))).rejects.toThrow("Sentetik bağ");
    expect(await takipSayilari(f)).toEqual({ takip: 0, bag: 0, audit: 0 });
    const eski = await elleTakip(f);
    await expect(baglam(f, () => new TahsilatTakibiService(adapter as never).gecikenSozleriBagla(f.cariId))).rejects.toThrow("Sentetik bağ");
    expect((await baglam(f, () => takipServisi.getir(eski.id))).kayit.surum).toBe(1);
  });
  it("bağ FORCE RLS/tenant kapsamındadır ve sonradan değiştirilemez", async () => {
    const f = await fixture(), diger = await fixture(), s = await geciken(f); await otomasyonAc(f); await tarayici.taraTenant(f.tenantId);
    expect(await a.tahsilatSozBaglantisi.findMany()).toEqual([]);
    expect(await tx(diger, (t) => t.tahsilatSozBaglantisi.findMany())).toEqual([]);
    const bag = await tx(f, (t) => t.tahsilatSozBaglantisi.findUniqueOrThrow({ where: { sozId: s.id } }));
    await expect(tx(f, (t) => t.tahsilatSozBaglantisi.update({ where: { id: bag.id }, data: { kalan: "1" } }))).rejects.toThrow();
    await expect(tx(f, (t) => t.tahsilatSozBaglantisi.delete({ where: { id: bag.id } }))).rejects.toThrow();
    const ds = await geciken(diger);
    await expect(tx(diger, (t) => t.tahsilatSozBaglantisi.create({ data: { tenantId: diger.tenantId, sozId: ds.id, takipId: bag.takipId, userId: diger.userId, kalan: "1" } }))).rejects.toThrow();
    const [rls] = await a.$queryRaw<any[]>`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='tahsilat_soz_baglantilari'`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("F02 sözlerin gerçek nakit kaynağına bağlanması", () => {
  it("iki bağlantıda ödeme değişirken söz ve fatura aynı snapshot'tan okunur", async () => {
    const f = await fixture(); await eskiSoz(f); const { k } = await odeme(f);
    let hazir!: () => void, devam!: () => void;
    const okundu = new Promise<void>((r) => { hazir = r; }), birak = new Promise<void>((r) => { devam = r; });
    const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>, secenek: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }) => a.tenantIslem(tenantId, (t) => is(new Proxy(t, { get(target, key) {
      if (key !== "modulAyar") return Reflect.get(target, key);
      return { findUnique: async (args: Prisma.ModulAyarFindUniqueArgs) => {
        const ayar = await t.modulAyar.findUnique(args); hazir(); await birak; return ayar;
      } };
    } })), secenek) };
    const okuma = baglam(f, () => new NakitAkisiService(adapter as never, {} as never).tahmin(30));
    try {
      await okundu;
      await baglam(f, () => b.tenantIslem(f.tenantId, (t) => t.faturaKapama.delete({ where: { id: k.id } })));
    } finally { devam(); }
    const sonuc = await okuma;
    expect(sonuc.kalemler.find((p) => p.odemeSozu)?.dovizTutar).toBe(600);
    expect(sonuc.kalemler.filter((p) => p.kaynakId === f.faturaId).reduce((t, p) => t + p.dovizTutar, 0)).toBe(1600);
    expect((await nakit(f)).kalemler.find((p) => p.odemeSozu)?.dovizTutar).toBe(1000);
  });
  it("400 ödeme sonrası 600 söz ve 1000 normal pay; para/bakiye/audit yazmaz", async () => {
    const f = await fixture(); await eskiSoz(f); await odeme(f);
    const once = await finans(f);
    const sonuc = await nakit(f);
    const paylar = sonuc.kalemler.filter((k) => k.kaynakId === f.faturaId);
    expect(paylar).toHaveLength(2);
    expect(paylar.find((p) => p.odemeSozu)).toMatchObject({ dovizTutar: 600, vade: gun(7) });
    expect(paylar.reduce((t, p) => t + p.dovizTutar, 0)).toBe(1600);
    expect(await finans(f)).toBe(once);
  });
  it("söz eski vadeli faturayı ufuk dışına taşıyınca ufukta ikinci kez sayılmaz", async () => {
    const f = await fixture(); await olustur(f, { ...govde(f), tutar: "2000.00", sozTarihi: gun(60) });
    const sonuc = await nakit(f);
    expect(sonuc.senaryolar.iyimser.toplamGiris).toBe(0);
    expect(sonuc.kalemler.filter((k) => k.kaynakId === f.faturaId)).toMatchObject([{ dovizTutar: 2000, vade: gun(60) }]);
  });
  it("fatura vadesi ufuk dışında olsa da ufuktaki söz payını getirir", async () => {
    const f = await fixture(); await olustur(f);
    await tx(f, (t) => t.fatura.update({ where: { id: f.faturaId }, data: { vadeTarihi: tarih(60) } }));
    const sonuc = await nakit(f);
    expect(sonuc.senaryolar.iyimser.toplamGiris).toBe(1000);
  });
  it.each([null, "kapali"])("mod %s iken ödeme sözü okumaz ve eski vade korunur", async (mod) => {
    const f = await fixture(); await eskiSoz(f);
    await tx(f, (t) => mod ? t.modulAyar.updateMany({ data: { ayarlar: { surum: 1, mod } } }) : t.modulAyar.deleteMany());
    const sonuc = await nakit(f);
    expect(sonuc.kalemler.filter((k) => k.kaynakId === f.faturaId)).toMatchObject([{ dovizTutar: 2000, odemeSozu: undefined }]);
  });
  it("iptal ve gecikmiş sözü kullanmaz; salt okunur şirket modunda geçerli sözü okur", async () => {
    const f = await fixture(), s = await olustur(f);
    await baglam(f, () => servis.iptal(s.id, { beklenenSurum: 1, gerekce: "İptal isteği" }));
    expect((await nakit(f)).kalemler.some((k) => k.odemeSozu)).toBe(false);
    await tx(f, (t) => t.odemeSozu.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, dovizCinsi: "TRY", tutar: "1000", sozTarihi: tarih(-1), verildigiZaman: new Date(Date.now() - 3 * 86400000), olusturanUserId: f.userId, aciklama: "Gecikmiş söz", istekAnahtari: randomUUID(), girdiOzeti: "b".repeat(64) } }));
    expect((await nakit(f)).kalemler.some((k) => k.odemeSozu)).toBe(false);
    const diger = await fixture(); await olustur(diger);
    await tx(diger, (t) => t.modulAyar.updateMany({ data: { ayarlar: { surum: 1, mod: "salt_okunur" } } }));
    expect((await nakit(diger)).kalemler.some((k) => k.odemeSozu)).toBe(true);
  });
  it("başka şirketin sözü okunmaz; yetkisiz rol doğrudan adaptörden de okuyamaz", async () => {
    const f = await fixture(), diger = await fixture(); await olustur(diger);
    expect((await nakit(f)).kalemler.some((k) => k.odemeSozu)).toBe(false);
    await olustur(f);
    const sonuc = await baglam(f, () => a.tenantIslem(f.tenantId, (t) => nakitSozleriniOku(t, f.tenantId, gun(0))), "satis");
    expect(sonuc.size).toBe(0);
  });
  it("ödeme geri alınınca söz payı güncel kapamadan yeniden büyür", async () => {
    const f = await fixture(); await eskiSoz(f); const { k } = await odeme(f);
    expect((await nakit(f)).kalemler.find((p) => p.odemeSozu)?.dovizTutar).toBe(600);
    await tx(f, (t) => t.faturaKapama.delete({ where: { id: k.id } }));
    expect((await nakit(f)).kalemler.find((p) => p.odemeSozu)?.dovizTutar).toBe(1000);
  });
});

describe("Kalıcı söz ve güvenli geçmiş", () => {
  it("oluşturur, idempotent tekrar tek kayıt/audit üretir ve finansı değiştirmez", async () => {
    const f = await fixture(), g = govde(f), once = await finans(f);
    const s = await olustur(f, g); expect(await olustur(f, g)).toEqual(s);
    expect(s).toMatchObject({ tutar: "1000.00", surum: 1, kayitDurumu: "aktif" });
    expect(await finans(f)).toBe(once);
    const sayilar = await tx(f, async (t) => [await t.odemeSozu.count(), await t.auditLog.count({ where: { varlik: "odeme_sozu" } })]);
    expect(sayilar).toEqual([1, 1]);
    expect((await liste(f)).sozler[0]).not.toHaveProperty("girdiOzeti");
    expect(odemeSozuListesiniDogrula(await liste(f), f.cariId).sozler[0].tutar).toBe("1000.00");
    await expect(olustur(f, { ...g, tutar: "900.00" })).rejects.toMatchObject({ status: 409 });
  });
  it("aynı faturada ikinci aktif sözü reddeder", async () => {
    const f = await fixture(); await olustur(f);
    await expect(olustur(f)).rejects.toMatchObject({ status: 409 });
  });
  it("revizyon eski içeriği korur, gerekçe ve zincir oluşturur; eski sürümü reddeder", async () => {
    const f = await fixture(), s = await olustur(f);
    const g = { tutar: "900.00", sozTarihi: gun(8), aciklama: "Yeni tarih", gerekce: "Müşteri tarihi değiştirdi", beklenenSurum: 1, istekAnahtari: randomUUID() };
    const yeni = await baglam(f, () => servis.revize(s.id, g));
    expect(yeni).toMatchObject({ oncekiSozId: s.id, tutar: "900.00", kayitDurumu: "aktif" });
    expect(await baglam(f, () => servis.revize(s.id, g))).toEqual(yeni);
    expect(await tx(f, (t) => t.odemeSozu.findUniqueOrThrow({ where: { id: s.id } }))).toMatchObject({ tutar: D("1000"), kayitDurumu: "revize", surum: 2, sonlandirmaNedeni: g.gerekce });
    await expect(baglam(f, () => servis.iptal(s.id, { beklenenSurum: 1, gerekce: "İptal" }))).rejects.toMatchObject({ status: 409 });
  });
  it("revizyon yaratma hatası eski sözü ve audit'i de geri alır", async () => {
    const f = await fixture(), s = await olustur(f);
    // Yeni tarihi geçersiz yaparak transaction içinde reddet.
    await expect(baglam(f, () => servis.revize(s.id, { tutar: "3000.00", sozTarihi: gun(1), aciklama: "Yeni söz", gerekce: "Revizyon", beklenenSurum: 1, istekAnahtari: randomUUID() }))).rejects.toMatchObject({ status: 400 });
    expect((await liste(f)).sozler).toHaveLength(1);
    expect((await liste(f)).sozler[0].kayitDurumu).toBe("aktif");
  });
  it("audit yazımı başarısızsa eski sözü sonlandırma ve yeni revizyon atomik geri alınır", async () => {
    const f = await fixture(), s = await olustur(f);
    const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => a.tenantIslem(tenantId, (t) => is(new Proxy(t, { get(target, key) {
      if (key === "auditLog") return { create: async () => { throw new Error("Sentetik audit hatası"); } };
      return Reflect.get(target, key);
    } }))) };
    const hatali = new OdemeSozuService(adapter as unknown as PrismaService);
    await expect(baglam(f, () => hatali.revize(s.id, { tutar: "900.00", sozTarihi: gun(8), aciklama: "Yeni söz", gerekce: "Revizyon", beklenenSurum: 1, istekAnahtari: randomUUID() }))).rejects.toThrow("Sentetik audit");
    expect((await liste(f)).sozler).toHaveLength(1);
    expect((await liste(f)).sozler[0]).toMatchObject({ kayitDurumu: "aktif", surum: 1 });
    expect(await tx(f, (t) => t.auditLog.count({ where: { varlik: "odeme_sozu" } }))).toBe(1);
  });
  it("iptal gerekçeli ve sürümlüdür; fatura taslak olsa da iptal edilebilir", async () => {
    const f = await fixture(), s = await olustur(f), once = await finans(f);
    const iptal = await baglam(f, () => servis.iptal(s.id, { beklenenSurum: 1, gerekce: "Müşteri sözünü geri çekti" }));
    expect(iptal).toMatchObject({ kayitDurumu: "iptal", surum: 2 }); expect(await finans(f)).toBe(once);
    const f2 = await fixture(), s2 = await olustur(f2);
    await tx(f2, (t) => t.fatura.update({ where: { id: f2.faturaId }, data: { durum: "taslak" } }));
    expect((await baglam(f2, () => servis.iptal(s2.id, { beklenenSurum: 1, gerekce: "Taslağa döndü" })))).toMatchObject({ kayitDurumu: "iptal" });
  });
  it("iki gerçek bağlantıdan aynı anahtar tek söz üretir", async () => {
    const f = await fixture(), g = govde(f);
    const [s1, s2] = await Promise.all([olustur(f, g), baglam(f, () => servisB.olustur(g))]);
    expect(s1.id).toBe(s2.id); expect(await tx(f, (t) => t.odemeSozu.count())).toBe(1);
  });
  it("eşzamanlı revizyon/iptalde yalnız biri başarılı olur", async () => {
    const f = await fixture(), s = await olustur(f);
    const sonuc = await Promise.allSettled([
      baglam(f, () => servis.revize(s.id, { tutar: "900.00", sozTarihi: gun(8), aciklama: "Yeni söz", gerekce: "Değişti", beklenenSurum: 1, istekAnahtari: randomUUID() })),
      baglam(f, () => servisB.iptal(s.id, { beklenenSurum: 1, gerekce: "Vazgeçildi" })),
    ]);
    expect(sonuc.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((sonuc.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.status).toBe(409);
  });
});

describe("Gerçek DB kaynak okuması", () => {
  it("400 + 600, kapama kimliği yenileme ve 400 geri alma doğru türetilir", async () => {
    const f = await fixture(); await eskiSoz(f); const p = await odeme(f);
    expect((await liste(f)).sozler[0].gerceklesme).toMatchObject({ durum: "kismen_gerceklesti", kalan: "600.00" });
    const p2 = await odeme(f, "600");
    expect((await liste(f)).sozler[0].gerceklesme?.durum).toBe("gerceklesti");
    await tx(f, async (t) => { await t.faturaKapama.delete({ where: { id: p2.k.id } }); await t.faturaKapama.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, kasaBankaHareketId: p2.h.id, tutar: "600", otomatik: true } }); });
    expect((await liste(f)).sozler[0].gerceklesme?.gerceklesen).toBe("1000.00");
    await tx(f, async (t) => { await t.faturaKapama.delete({ where: { id: p.k.id } }); await t.kasaBankaHareket.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "tediye", tutar: "400", tutarTry: "400", dovizCinsi: "TRY", kur: "1", tarih: tarih(0), kaynakTur: "ters_kayit", kaynakRef: p.h.id } }); });
    const once = await finans(f);
    expect((await liste(f)).sozler[0].gerceklesme).toMatchObject({ durum: "kismen_gerceklesti", gerceklesen: "600.00", kalan: "400.00" });
    expect(await finans(f)).toBe(once);
  });
  it("stale kapama, ters kayıt sonrası net kapasiteyi aşarsa başarı yerine 409 döner", async () => {
    const f = await fixture(); await eskiSoz(f); const p = await odeme(f);
    await tx(f, (t) => t.kasaBankaHareket.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "tediye", tutar: "100", tutarTry: "100", dovizCinsi: "TRY", kur: "1", tarih: tarih(0), kaynakTur: "ters_kayit", kaynakRef: p.h.id } }));
    await expect(liste(f)).rejects.toMatchObject({ status: 409 });
  });
  it("aynı gün yeni kayıt saati, eski işlem gününü gerçekleşme yapmaz", async () => {
    const f = await fixture(); await olustur(f); await odeme(f, "400", 0);
    expect((await liste(f)).sozler[0].gerceklesme?.gerceklesen).toBe("0.00");
  });
  it("taslağa alınan hedefin eski gerçekleşmesi düşer", async () => {
    const f = await fixture(); await eskiSoz(f); await odeme(f, "1000");
    await tx(f, (t) => t.fatura.update({ where: { id: f.faturaId }, data: { durum: "taslak" } }));
    expect((await liste(f)).sozler[0].gerceklesme).toMatchObject({ durum: "kaynak_gecersiz", gerceklesen: "0.00" });
  });
  it("POS kısmi iadesinde güncel net kapama kadar gerçekleşme sayılır", async () => {
    const f = await fixture(); await eskiSoz(f); const p = await odeme(f, "1000");
    await tx(f, async (t) => {
      const pos = await t.posHesap.create({ data: { tenantId: f.tenantId, ad: "POS", saglayici: "test" } });
      const tahsilat = await t.posTahsilat.create({ data: { tenantId: f.tenantId, cariId: f.cariId, posHesapId: pos.id, tutar: "1000", hareketId: p.h.id, durum: "odendi", makbuzAnahtari: randomUUID() } });
      await t.kasaBankaHareket.update({ where: { id: p.h.id }, data: { kaynakTur: "pos_tahsilat" } });
      await t.kasaBankaHareket.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "tediye", tutar: "400", tutarTry: "400", dovizCinsi: "TRY", kur: "1", tarih: tarih(0), kaynakTur: "pos_iade", kaynakRef: tahsilat.id } });
      await t.faturaKapama.update({ where: { id: p.k.id }, data: { tutar: "600" } });
    });
    expect((await liste(f)).sozler[0].gerceklesme).toMatchObject({ gerceklesen: "600.00", kalan: "400.00" });
  });
  it("aynı kaynağın diğer faturadaki payı da kapasiteye dahildir", async () => {
    const f = await fixture(); await eskiSoz(f); const p = await odeme(f, "400");
    await tx(f, async (t) => {
      const eski = await t.fatura.findUniqueOrThrow({ where: { id: f.faturaId } });
      const diger = await t.fatura.create({ data: { tenantId: f.tenantId, cariId: f.cariId, tip: "satis", durum: "kesin", tarih: eski.tarih, dovizCinsi: "TRY", kur: "1", toplamBrut: "200", toplamMatrah: "200", genelToplam: "200", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "0", toplamTevkifat: "0", toplamNetKdv: "0" } });
      await t.faturaKapama.create({ data: { tenantId: f.tenantId, cariId: f.cariId, faturaId: diger.id, kasaBankaHareketId: p.h.id, tutar: "200" } });
    });
    await expect(liste(f)).rejects.toMatchObject({ status: 409 });
  });
  it("RepeatableRead eski söz ve eski ödeme snapshot'ını birlikte tutar", async () => {
    const f = await fixture(), s = await eskiSoz(f); await odeme(f);
    let hazir!: () => void, devam!: () => void;
    const okundu = new Promise<void>((r) => { hazir = r; }); const bekle = new Promise<void>((r) => { devam = r; });
    const adapter = { tenantIslem: (tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>, secenek: any) => a.tenantIslem(tenantId, async (t) => {
      expect((await t.$queryRaw<any[]>`SHOW transaction_isolation`)[0].transaction_isolation).toBe("repeatable read");
      return is(new Proxy(t, { get(target, key) {
        if (key === "odemeSozu") return { findMany: async (args: any) => { const sonuc = await target.odemeSozu.findMany(args); hazir(); await bekle; return sonuc; } };
        return Reflect.get(target, key);
      } }));
    }, secenek) };
    const okuyucu = new OdemeSozuService(adapter as unknown as PrismaService);
    const sonuc = baglam(f, () => okuyucu.listele({ cariId: f.cariId }));
    try {
      await okundu;
      await baglam(f, () => servisB.iptal(s.id, { beklenenSurum: 1, gerekce: "Geri alındı" }));
      await baglam(f, () => b.tenantIslem(f.tenantId, (t) => t.faturaKapama.deleteMany({ where: { tenantId: f.tenantId } })));
    } finally { devam(); }
    expect((await sonuc).sozler[0]).toMatchObject({ kayitDurumu: "aktif", gerceklesme: { gerceklesen: "400.00" } });
    expect((await liste(f)).sozler[0]).toMatchObject({ kayitDurumu: "iptal", gerceklesme: { gerceklesen: "0.00" } });
  });
  it("1001 geçmiş kayıt kısmi listeye kırpılmaz; yeni söz oluşturulmaz", async () => {
    const f = await fixture();
    await tx(f, (t) => t.odemeSozu.createMany({ data: Array.from({ length: 1001 }, () => ({ tenantId: f.tenantId, cariId: f.cariId, faturaId: f.faturaId, dovizCinsi: "TRY" as const, tutar: "1", sozTarihi: tarih(1), olusturanUserId: f.userId, aciklama: "Sentetik geçmiş", kayitDurumu: "iptal", sonlandirmaNedeni: "Geçmiş kayıt", istekAnahtari: randomUUID(), girdiOzeti: "b".repeat(64) })) }));
    await expect(liste(f)).rejects.toMatchObject({ status: 400 });
    await expect(olustur(f)).rejects.toMatchObject({ status: 400 });
  });
});

describe("RLS, yetki ve HTTP sözleşmesi", () => {
  it("bağlam olmadan satır yok; yabancı tenant yazımı ve bağları reddedilir", async () => {
    const f = await fixture(), diger = await fixture(); const s = await olustur(f);
    expect(await a.odemeSozu.findMany()).toEqual([]);
    expect(await tx(diger, (t) => t.odemeSozu.findMany())).toEqual([]);
    await expect(baglam(diger, () => servis.iptal(s.id, { beklenenSurum: 1, gerekce: "Yabancı" }))).rejects.toMatchObject({ status: 404 });
    await expect(olustur(diger, { ...govde(diger), faturaId: f.faturaId })).rejects.toMatchObject({ status: 404 });
    await expect(tx(diger, (t) => t.odemeSozu.create({ data: { tenantId: diger.tenantId, cariId: diger.cariId, faturaId: f.faturaId, dovizCinsi: "TRY", tutar: "100", sozTarihi: tarih(1), olusturanUserId: diger.userId, aciklama: "Geçersiz", istekAnahtari: randomUUID(), girdiOzeti: "a".repeat(64) } }))).rejects.toThrow();
  });
  it("DB geçmiş değişikliğini ve silmeyi reddeder", async () => {
    const f = await fixture(), s = await olustur(f);
    await expect(tx(f, (t) => t.odemeSozu.update({ where: { id: s.id }, data: { tutar: "10" } }))).rejects.toThrow();
    await expect(tx(f, (t) => t.odemeSozu.delete({ where: { id: s.id } }))).rejects.toThrow();
  });
  it.each([null, "kapali", "salt_okunur"])("%s modunda yönetici yazamaz", async (mod) => {
    const f = await fixture(mod); await expect(olustur(f)).rejects.toMatchObject({ status: 403 });
    if (mod === "salt_okunur") expect((await liste(f)).kullanimModu).toBe("salt_okunur");
    else await expect(liste(f)).rejects.toMatchObject({ status: 403 });
  });
  it("mod ayarı değişikliği audit üretir", async () => {
    const f = await fixture("kapali");
    await baglam(f, () => new AyarlarService(a).guncelle("tahsilat_operasyonu", { surum: 1, mod: "pilot" }));
    expect(await tx(f, (t) => t.auditLog.count({ where: { islem: "tahsilat_modu_guncellendi" } }))).toBe(1);
  });
  it("mod kapatma gerçek söz transaction'ının commit'ini bekler", async () => {
    const f = await fixture();
    let hazir!: (pid: number) => void, devam!: () => void, ikinciPid!: (pid: number) => void;
    const ilkPid = new Promise<number>((r) => { hazir = r; }), birak = new Promise<void>((r) => { devam = r; });
    const bekleyenPid = new Promise<number>((r) => { ikinciPid = r; });
    const yazma = baglam(f, () => a.tenantIslem(f.tenantId, async (t) => {
      const adapter = { tenantIslem: (_tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => is(t) };
      const s = await new OdemeSozuService(adapter as unknown as PrismaService).olustur(govde(f));
      hazir((await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
      await birak; return s;
    }, { timeout: 15000 }));
    let ayar: Promise<unknown> | undefined;
    try {
      const tutan = await ilkPid;
      ayar = baglam(f, () => b.tenantIslem(f.tenantId, async (t) => {
        ikinciPid((await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
        const adapter = { tenantIslem: (_tenantId: string, is: (t: Prisma.TransactionClient) => Promise<unknown>) => is(t) };
        return new AyarlarService(adapter as unknown as PrismaService).guncelle("tahsilat_operasyonu", { surum: 1, mod: "kapali" });
      }, { timeout: 15000 }));
      const bekleyen = await bekleyenPid, deadline = Date.now() + 5000;
      let bloklandi = false;
      while (Date.now() < deadline) {
        const [r] = await a.$queryRaw<{ blockers: number[] }[]>`SELECT pg_blocking_pids(${bekleyen}::int) AS blockers`;
        if (r.blockers.includes(tutan)) { bloklandi = true; break; }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(bloklandi).toBe(true);
    } finally { devam(); await Promise.all([yazma, ayar]); }
    await expect(liste(f)).rejects.toMatchObject({ status: 403 });
    expect(await tx(f, (t) => t.odemeSozu.count())).toBe(1);
  });
  it.each(["mali_musavir", "salt_okunur", "satis", "calisan"] as Rol[])("serviste %s yazamaz", async (rol) => {
    const f = await fixture(); await expect(baglam(f, () => servis.olustur(govde(f)), rol)).rejects.toMatchObject({ status: 403 });
  });
  it("HTTP: gerçek controller/role guard, no-store, katı gövde ve yabancı cari", async () => {
    const f = await fixture();
    const headers = { "x-test-tenant": f.tenantId, "x-test-user": f.userId, "x-test-rol": "muhasebe", "Content-Type": "application/json" };
    const g = govde(f);
    const res = await fetch(`${base}/cari/odeme-sozleri`, { method: "POST", headers, body: JSON.stringify(g) });
    expect(res.status).toBe(201); expect((await res.json()).tutar).toBe("1000.00");
    const get = await fetch(`${base}/cari/odeme-sozleri?cariId=${f.cariId}`, { headers });
    expect(get.status).toBe(200); expect(get.headers.get("cache-control")).toBe("no-store");
    expect((await get.json()).sozler).toHaveLength(1);
    expect((await fetch(`${base}/cari/odeme-sozleri`, { method: "POST", headers: { ...headers, "x-test-rol": "salt_okunur" }, body: JSON.stringify(g) })).status).toBe(403);
    expect((await fetch(`${base}/cari/odeme-sozleri`, { method: "POST", headers, body: JSON.stringify({ ...g, gerceklesen: "1000" }) })).status).toBe(400);
    expect((await fetch(`${base}/cari/odeme-sozleri?cariId=${randomUUID()}`, { headers })).status).toBe(404);
  });
});
