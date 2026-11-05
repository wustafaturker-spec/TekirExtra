import { kabulPaketleri } from "./platform-paket-fixture";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { gunEkle, istatistikFiltreSemasi } from "../src/mevzuat/platform-istatistik-filtre";
import { PlatformIstatistikService } from "../src/mevzuat/platform-istatistik.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";

interface Donem {
  tam: boolean; baslangicFirma: number | null; bitisFirma: number | null; yeniFirma: number | null;
  silinenFirma: number | null; netDegisim: number | null; iptalFirma: number | null;
  deneme: { baslayan: number | null; olgunlasan: number | null; donusen: number | null; bekleyen: number | null; oran: number | null };
}
interface Rapor { olcumBaslangici: string; donem: Donem; onceki: Donem }
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const paketler = kabulPaketleri(admin, db);
const ids = Array.from({ length: 7 }, () => randomUUID());
const [a, b, c, d, e, f, g] = ids;
const plan = `buyume_${randomUUID().slice(0, 8)}`;
const gun = (n: number) => gunEkle(bugunTR(), n);
const an = (n: number) => new Date(`${gun(n)}T12:00:00+03:00`);
let eskiBaslangic: Date;
async function rapor(bas = gun(-45), bit = gun(-1), firma: string | null = null, paket: string | null = plan) {
  const [r] = await db.$queryRaw<{ veri: Rapor }[]>`SELECT platform_buyume_raporu(${bas}::date, ${bit}::date, ${paket}::text, ${firma}::uuid) AS veri`;
  return r.veri;
}
async function odeme(id: string, n: number, tutar = 100) {
  const p = await admin.abonelikOdemesi.create({ data: { tenantId: id, aySayisi: 1, tutar, yeniDonemSonu: an(30), kaynak: "saglayici", saglayici: "iyzico" } });
  if (tutar > 0) await admin.platformBuyumeOdemesi.update({ where: { odemeId: p.id }, data: { olayAt: an(n) } });
  return p.id;
}
async function durum(id: string, yeni: "aktif" | "iptal" | "deneme", n: number, paket?: string) {
  const once = await admin.platformFirmaYasamOlayi.findFirstOrThrow({ where: { tenantId: id }, orderBy: { id: "desc" } });
  await admin.tenantAbonelik.update({ where: { tenantId: id }, data: { durum: yeni } });
  if (paket) await paketler.gecir(id, paket);
  await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: id, id: { gt: once.id } }, data: { olayAt: an(n) } });
}
beforeAll(async () => {
  eskiBaslangic = (await admin.platformBuyumeAyari.findUniqueOrThrow({ where: { id: 1 } })).baslangic;
  await admin.platformBuyumeAyari.update({ where: { id: 1 }, data: { baslangic: an(-100) } });
  for (const id of ids) {
    await admin.tenant.create({ data: { id, unvan: `BUYUME-${id}`, vkn: id.replaceAll("-", "").slice(0, 10), createdAt: an(-200) } });
    await paketler.olustur( { tenantId: id, planKodu: id === b ? `${plan}_diger` : plan, durum: "deneme" });
    await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: id, tip: "kayit" }, data: { olayAt: an(id === d ? -4 : -40) } });
    await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: id, tip: "abonelik" }, data: { olayAt: an(id === d ? -3 : -30) } });
  }
  // Önceden var olan denemeyi geçmişi bilinen yeni firma gibi sayma.
  await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: f, tip: "kayit" }, data: { tip: "baslangic" } });
  await odeme(a, -20); await odeme(a, -19); // aynı firma iki ödemeyle iki kez dönüşmez
  await odeme(c, -16); // tam 14. gün sınırı dışarıda
  await odeme(d, -2); // ödeme yapsa da 14 gün dolmadı
  await odeme(e, -31); await odeme(e, -20); // denemeden önce ücret ödemiş; yeni deneme müşterisi değil
  await odeme(f, -20); await odeme(g, -20, 0); // sıfır tutar dönüşüm değil
  await durum(a, "aktif", -19); await durum(a, "iptal", -15);
  await durum(a, "aktif", -12); await durum(a, "iptal", -10);
  await durum(a, "aktif", -5, `${plan}_yeni`);
});
afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: ids } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformBuyumeOdemesi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformBuyumeAyari.update({ where: { id: 1 }, data: { baslangic: eskiBaslangic } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("büyüme ve deneme kohortu — gerçek PostgreSQL", () => {
  it("büyüme sınırları, net değişim ve benzersiz iptal sayısı kaynak geçişlerinden hesaplanır", async () => {
    const r = await rapor(gun(-45), gun(-1), a, null);
    expect(r.donem).toMatchObject({ tam: true, baslangicFirma: 0, bitisFirma: 1, yeniFirma: 1, silinenFirma: 0, netDegisim: 1, iptalFirma: 1 });
    expect((await rapor(gun(-20), gun(-1), a, null)).donem).toMatchObject({ baslangicFirma: 1, yeniFirma: 0, netDegisim: 0, iptalFirma: 1 });
    expect(r.onceki.yeniFirma).toBe(0);
  });
  it("14 günlük payda olgun kohorttur; tekrar ödeme, geç ödeme ve önceden ücretli firmalar şişirmez", async () => {
    expect((await rapor(gun(-35), gun(-25), a, null)).donem.deneme).toEqual({ baslayan: 1, olgunlasan: 1, donusen: 1, bekleyen: 0, oran: 100 });
    expect((await rapor(gun(-35), gun(-25), c, null)).donem.deneme).toMatchObject({ olgunlasan: 1, donusen: 0, oran: 0 });
    expect((await rapor(gun(-35), gun(-25), e, null)).donem.deneme).toMatchObject({ baslayan: 0, olgunlasan: 0, oran: null });
    expect((await rapor(gun(-35), gun(-25), g, null)).donem.deneme.donusen).toBe(0);
    expect((await rapor(gun(-35), gun(-25), f, null)).donem.deneme.baslayan).toBe(0);
  });
  it("gözlem süresi bekleyen firma erken ödeme yapsa da oranın payına/paydasına girmez", async () => {
    expect((await rapor(gun(-4), gun(-1), d, null)).donem.deneme).toEqual({ baslayan: 1, olgunlasan: 0, donusen: 0, bekleyen: 1, oran: null });
    // Aynı firmada yeniden deneme ilk kohortu çoğaltmaz.
    await durum(d, "aktif", -2); await durum(d, "deneme", -1);
    expect((await rapor(gun(-4), gun(-1), d, null)).donem.deneme.baslayan).toBe(1);
  });
  it("paket kapsamı raporun dönem sonu geçmişidir, bugünkü paket geriye uygulanmaz", async () => {
    expect((await rapor(gun(-45), gun(-25), a)).donem.yeniFirma).toBe(1);
    expect((await rapor(gun(-45), gun(-1), a)).donem.yeniFirma).toBe(0);
    expect((await rapor(gun(-45), gun(-1), a, `${plan}_yeni`)).donem.yeniFirma).toBe(1);
    expect((await rapor(gun(-45), gun(-1), b)).donem.bitisFirma).toBe(0);
  });
  it("ölçüm öncesi günler sıfır sayılmaz; API aynı işlem içinde büyüme raporunu taşır", async () => {
    const eksik = await rapor(gun(-101), gun(-99), a, null);
    expect(eksik.donem).toMatchObject({ tam: false, baslangicFirma: null, bitisFirma: null, yeniFirma: null, netDegisim: null });
    expect(eksik.donem.deneme.oran).toBeNull();
    const service = new PlatformIstatistikService({ db } as never);
    const f = istatistikFiltreSemasi.parse({ baslangic: gun(-45), bitis: gun(-1), firma: a });
    const api = await platformBaglamiylaCalistir({ kullaniciId: randomUUID(), eposta: "test@ornek.invalid", rol: "yonetici" }, () => service.rapor(f));
    const beklenen = await rapor(gun(-45), gun(-1), a, null);
    expect(api.buyume).toMatchObject({ donem: beklenen.donem, onceki: beklenen.onceki });
  });
  it("silinen firma geçmişte kalır, iptal ile silme birbirinden ayrılır", async () => {
    await admin.tenant.delete({ where: { id: c } });
    await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: c, mevcut: false }, data: { olayAt: an(-2) } });
    expect((await rapor(gun(-20), gun(-1), c)).donem).toMatchObject({ baslangicFirma: 1, bitisFirma: 0, silinenFirma: 1, netDegisim: -1, iptalFirma: 0 });
    expect((await rapor(gun(-35), gun(-25), c)).donem.deneme.baslayan).toBe(1);
  });
  it("kaynak işlem geri alınırsa olay da geri alınır; salt yenileme yeni yaşam olayı değildir", async () => {
    const once = await admin.platformFirmaYasamOlayi.count({ where: { tenantId: b } });
    await expect(admin.$transaction(async (tx) => {
      await tx.tenantAbonelik.update({ where: { tenantId: b }, data: { durum: "iptal" } });
      throw new Error("kabul geri al");
    })).rejects.toThrow("kabul geri al");
    await admin.tenantAbonelik.update({ where: { tenantId: b }, data: { donemSonu: an(50) } });
    expect(await admin.platformFirmaYasamOlayi.count({ where: { tenantId: b } })).toBe(once);
  });
  it("uygulama rolündeki kaynak yazısı geçmiş üretir; geriye tarihli kayıt gözlem anını geri taşımaz", async () => {
    const id = randomUUID(); ids.push(id);
    await app.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      await tx.tenant.create({ data: { id, unvan: `BUYUME-${id}`, vkn: id.replaceAll("-", "").slice(0, 10), createdAt: an(-200) } });
      await tx.tenantAbonelik.create({ data: { tenantId: id, durum: "deneme", planKodu: plan } });
    });
    const olay = await admin.platformFirmaYasamOlayi.findFirstOrThrow({ where: { tenantId: id, tip: "kayit" } });
    expect(olay.olayAt.getTime()).toBeGreaterThan(an(-1).getTime());
    expect((await rapor(gun(-40), gun(-1), id)).donem.yeniFirma).toBe(0);
    // UTC 21:00 Türkiye'de sonraki gündür; sınır dahil/harici davranışı.
    await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: id }, data: { olayAt: new Date(`${gun(-2)}T21:00:00Z`) } });
    expect((await rapor(gun(-2), gun(-2), id)).donem.yeniFirma).toBe(0);
    expect((await rapor(gun(-1), gun(-1), id)).donem).toMatchObject({ baslangicFirma: 0, bitisFirma: 1, yeniFirma: 1 });
  });
  it("ham olay/ödeme tabloları ve iç yardımcı kapalıdır; dış işlev aralıkları doğrular", async () => {
    for (const rol of [db, app]) {
      for (const tablo of ["platform_buyume_ayari", "platform_firma_yasam_olaylari", "platform_buyume_odemeleri"]) await expect(rol.$queryRawUnsafe(`SELECT * FROM ${tablo}`)).rejects.toThrow(/permission denied/);
      await expect(rol.$queryRaw`SELECT platform_buyume_donemi(${gun(-1)}::date, ${gun(-1)}::date, NULL, NULL, now()::timestamp)`).rejects.toThrow(/permission denied/);
    }
    await expect(app.$queryRaw`SELECT platform_buyume_raporu(${gun(-1)}::date, ${gun(-1)}::date, NULL, NULL)`).rejects.toThrow(/permission denied/);
    await expect(rapor(gun(-100), gun(0))).rejects.toThrow(/Gecersiz/);
    await expect(rapor(gun(1), gun(1))).rejects.toThrow(/Gecersiz/);
    expect(JSON.stringify(await rapor())).not.toMatch(/tenant_id|odeme_id|BUYUME-/);
  });
});
