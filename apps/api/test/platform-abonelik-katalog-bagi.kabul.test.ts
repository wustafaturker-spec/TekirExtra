import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir, platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { AbonelikService } from "../src/tenant/abonelik.service";
import { ABONELIK_PLANLARI } from "../src/tenant/abonelik-planlari";
import { bagliAbonelikTutari, etkinAbonelikPlani } from "../src/tenant/abonelik-kosullari";
import { ABONELIK_SURELERI, abonelikTutari } from "../src/abonelik-odeme/abonelik-tutari";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { PlatformOdemeRaporuService } from "../src/abonelik-odeme/platform-odeme-raporu.service";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const kisi = randomUUID(), ids = Array.from({ length: 6 }, () => randomUUID());
const planlar = ["baslangic", "profesyonel", "kurumsal", "v1", "kabul_bilinmeyen"];
const paket = new PlatformPaketService({ db: platform } as never);
const yonetici = <T>(fn: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "katalog@kabul.invalid", rol: "yonetici" }, fn);
const abonelik = (i: number) => app.tenantIslem(ids[i], (tx) => tx.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: ids[i] } }));
const odeme = new AbonelikOdemeService(app, { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as never, { db: { mevzuatOlay: { create: vi.fn() } } } as never, { unut: vi.fn() } as never);
odeme.saglayiciUret = () => ({ odemeBaslat: async (g) => ({ token: g.denemeId, odemeSayfasiUrl: "https://kabul.invalid" }) }) as never;
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Katalog bağı kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  for (const [i, id] of ids.entries()) {
    await admin.tenant.create({ data: { id, unvan: `AA Katalog bağı ${i}`, vkn: String(i + 111).padStart(10, "0") } });
    await admin.user.create({ data: { tenantId: id, eposta: `${id}@kabul.invalid`, adSoyad: "Kabul yöneticisi", parolaHash: "x", rol: "yonetici" } });
    if (i < 5) await admin.tenantAbonelik.create({ data: { tenantId: id, planKodu: planlar[i], donemSonu: new Date(Date.now() + 86400000) } });
  }
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.user.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.tenant.deleteMany({ where: { id: { in: ids } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), platform.$disconnect(), app.$disconnect()]);
});
describe("abonelik-katalog bağı — gerçek PostgreSQL", () => {
  it("bilinen planlar ilk katalog sürümüne aynı fiyat/limitlerle bağlanır, v1 korunur", async () => {
    for (let i = 0; i < 4; i++) {
      const a = await abonelik(i), p = ABONELIK_PLANLARI.find((p) => p.kod === (planlar[i] === "v1" ? "profesyonel" : planlar[i]))!;
      const kaynak = await admin.platformPaketSurumu.findUniqueOrThrow({ where: { id: a.paketSurumId! }, include: { paket: true } });
      expect(kaynak.surumNo).toBe(1); expect(kaynak.paket.eskiPlanKodu).toBe(p.kod);
      expect(a.planKodu).toBe(planlar[i]); expect(etkinAbonelikPlani(a).limitler).toEqual(p.limitler);
      for (const ay of ABONELIK_SURELERI) expect(bagliAbonelikTutari(a, ay)?.toplam.toFixed(2) ?? null).toBe(abonelikTutari(planlar[i], ay)?.toplam.toFixed(2) ?? null);
    }
    expect((await abonelik(1)).paketSurumId).toBe((await abonelik(3)).paketSurumId);
  });
  it("bilinmeyen plan varsayılmaz ve çevrim içi fiyat üretilmez", async () => {
    expect(await abonelik(4)).toMatchObject({ paketSurumId: null, paketKosullari: null });
    await expect(odeme.baslat(ids[4], 1, "panel", null)).rejects.toThrow("çevrim içi ödeme yok");
  });
  it("korunmuş bağ ve koşullar doğrudan DB güncellemesiyle değiştirilemez", async () => {
    const a = await abonelik(0);
    await expect(app.tenantIslem(ids[0], (tx) => tx.tenantAbonelik.update({ where: { tenantId: ids[0] }, data: { paketKosullari: {} } }))).rejects.toThrow("degistirilemez");
    await expect(admin.$executeRaw`UPDATE tenant_abonelikleri SET paket_surum_id = NULL, paket_kosullari = NULL WHERE tenant_id = ${ids[0]}::uuid`).rejects.toThrow("degistirilemez");
    expect((await abonelik(0)).paketKosullari).toEqual(a.paketKosullari);
    await expect(app.tenantIslem(ids[0], (tx) => tx.platformPaketSurumu.findMany())).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM abonelik_eski_paket_bagi('baslangic')`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT platform_abonelik_katalog_durumu(1)`).rejects.toThrow();
  });
  it("yeni varsayılan abonelik v1 kodunu koruyarak Profesyonel sürüme bağlanır", async () => {
    const service = new AbonelikService(app);
    const r = await baglamlaCalistir({ tenantId: ids[5], userId: kisi, rol: "yonetici" }, () => service.ozet());
    expect(r.abonelik.planKodu).toBe("v1"); expect(r.plan.kod).toBe("profesyonel");
    expect(r.abonelik.paketSurumId).toBe((await abonelik(1)).paketSurumId);
  });
  it("iletişim ve eşdeğer plan kodu bağı korur; eski platform yolu paketler arası geçiş yapamaz", async () => {
    const a = await abonelik(3);
    await app.tenantIslem(ids[3], (tx) => tx.tenantAbonelik.update({ where: { tenantId: ids[3] }, data: { faturaEpostasi: "fatura@kabul.invalid" } }));
    expect((await abonelik(3)).paketKosullari).toEqual(a.paketKosullari);
    await expect(platform.$queryRaw`SELECT platform_abonelik_guncelle(${ids[3]}::uuid,'baslangic',NULL,'Kabul plan geçişi')::text`).rejects.toThrow();
    expect((await abonelik(3)).paketSurumId).toBe(a.paketSurumId);
    await platform.$queryRaw`SELECT platform_abonelik_guncelle(${ids[3]}::uuid,'v1',NULL,'Kabul plan geri geçişi')::text`;
    expect((await abonelik(3)).paketSurumId).toBe(a.paketSurumId);
  });
  it("yeni katalog fiyatı yayınlamak mevcut bağlı aboneleri veya fiyatlarını değiştirmez", async () => {
    const a = await abonelik(0), kaynak = await admin.platformPaketSurumu.findUniqueOrThrow({ where: { id: a.paketSurumId! } });
    const d = await yonetici(() => paket.taslakAc(kaynak.paketId, kaynak.id));
    const g = await yonetici(() => paket.guncelle(kaynak.paketId, d.id, { ad: "Yeni katalog fiyatı", aciklama: "Yeni satış için hazırlanıyor", ozellikler: ["Özellik"], siralama: 10, kilitSurumu: 1,
      fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-11-01", donemler: [{ aySayisi: 1, matrah: "4999.00" }] } }));
    await yonetici(() => paket.yayinla(kaynak.paketId, d.id, g.kilitSurumu));
    expect(await abonelik(0)).toEqual(a);
    expect(bagliAbonelikTutari(await abonelik(0), 1)?.toplam.toFixed(2)).toBe("478.80");
  });
  it("yenileme önizlemesi, panel seçenekleri ve ödeme girişimi aynı bağlı fiyatı okur", async () => {
    const rapor = await new PlatformOdemeRaporuService({ db: platform } as never).yaklasan(7);
    const satir = rapor.kayitlar.find((x) => x.tenantId === ids[0])!;
    const durum = await odeme.durum(ids[0]), bas = await odeme.baslat(ids[0], 1, "eposta", null);
    const d = await app.tenantIslem(ids[0], (tx) => tx.abonelikOdemeDenemesi.findUniqueOrThrow({ where: { id: bas.denemeId } }));
    expect(satir.beklenen).toMatchObject(durum.secenekler.find((x) => x.aySayisi === 1)!);
    expect(satir.beklenen?.toplam).toBe(d.toplam.toFixed(2));
    expect(d.fiyatFotografi).toMatchObject({ semaSurumu: 2, kaynak: "eski_plan_gecisi", paketSurumId: satir.paketSurumId, toplam: "478.80" });
  });
  it("bağlı sözleşme kullanıcı limitini uygular", async () => {
    await admin.user.createMany({ data: [1, 2].map((i) => ({ tenantId: ids[0], eposta: `${i}-${ids[0]}@kabul.invalid`, adSoyad: "Limit kabul", parolaHash: "x", rol: "yonetici" })) });
    await expect(baglamlaCalistir({ tenantId: ids[0], userId: kisi, rol: "yonetici" }, () => new AbonelikService(app).limitDogrula("kullanici"))).rejects.toThrow("limiti doldu (3)");
  });
  it("geçiş raporu bilinmeyen planı ayırır, dört dönem ve limit eşitliğini gösterir", async () => {
    const r = await yonetici(() => paket.gecisDurumu(1));
    expect(r.bilinmeyenPlan).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 4; i++) expect(r.kayitlar.find((x) => x.tenantId === ids[i])).toMatchObject({ kosullarEsit: true, donemler: ABONELIK_SURELERI.map((aySayisi) => ({ aySayisi, esit: true })) });
    expect(r.kayitlar.find((x) => x.tenantId === ids[4])).toMatchObject({ durum: "bilinmeyen_plan", kosullarEsit: null });
    expect(await yonetici(() => paket.gecisDurumu(100000))).toMatchObject({ toplam: r.toplam, kayitlar: [] });
    await platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "katalog@kabul.invalid", rol: "mevzuat_editoru" }, async () => {
      await expect(paket.gecisDurumu(1)).rejects.toThrow("yöneticisi");
    });
  });
});
