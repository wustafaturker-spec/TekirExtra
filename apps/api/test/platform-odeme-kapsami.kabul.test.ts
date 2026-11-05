import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformOdemeRaporuService } from "../src/abonelik-odeme/platform-odeme-raporu.service";

import { PlatformIstatistikService } from "../src/mevzuat/platform-istatistik.service";
import { istatistikFiltreSemasi } from "../src/mevzuat/platform-istatistik-filtre";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const id = randomUUID(), diger = randomUUID(), plan = `kapsam_${randomUUID().slice(0, 8)}`;
const service = new PlatformOdemeRaporuService({ db } as never);
const rapor = (sayfa = 1, durum = "basarisiz", paket = plan) => service.sorunlu("2026-10-01", "2026-10-02", { plan: paket, firma: id, durum, sayfa });
beforeAll(async () => {
  for (const tenantId of [id, diger]) {
    await admin.tenant.create({ data: { id: tenantId, unvan: "Ödeme kapsamı", vkn: tenantId.replaceAll("-", "").slice(0, 10) } });
    await admin.tenantAbonelik.create({ data: { tenantId, planKodu: plan, durum: "aktif" } });
  }
  const deneme = (tenantId: string, durum: string, createdAt: string) => ({ tenantId, durum, createdAt: new Date(createdAt), saglayici: "iyzico", ortam: "test", kaynak: "panel", aySayisi: 1, matrah: 100, kdv: 20, toplam: 120, planKodu: plan });
  await admin.abonelikOdemeDenemesi.createMany({ data: [
    ...Array.from({ length: 505 }, () => deneme(id, "basarisiz", "2026-10-01T12:00:00Z")),
    deneme(id, "basarisiz", "2026-09-30T21:00:00Z"),
    deneme(id, "basarisiz", "2026-10-02T20:59:59.999Z"),
    deneme(id, "basarisiz", "2026-09-30T20:59:59.999Z"),
    deneme(id, "basarisiz", "2026-10-02T21:00:00Z"),
    deneme(id, "baslatildi", "2026-10-01T12:00:00Z"),
    deneme(id, "odendi", "2026-10-01T12:00:00Z"),
    deneme(diger, "basarisiz", "2026-10-01T12:00:00Z"),
  ] });
});
afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: [id, diger] } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: [id, diger] } } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("ödeme kapsamı — gerçek PostgreSQL", () => {
  it("TR gün sınırları, durum, paket ve firma aynı toplamı üretir; 500 sınırı yoktur", async () => {
    const r = await rapor();
    expect(r.sayilar).toEqual({ basarisiz: 507, sonuclanmadi: 1 });
    expect(r.toplam).toBe(507); expect(r.denemeler).toHaveLength(50);
    expect((await rapor(11)).denemeler).toHaveLength(7);
    expect((await rapor(1, "sonuclanmadi")).toplam).toBe(1);
    expect((await rapor(1, "hepsi")).toplam).toBe(508);
    expect((await rapor(1, "hepsi", "olmayan")).toplam).toBe(0);
    expect(r.kartKapsami).toBe("gizli");
  });
  it("istatistik sayacı ödeme raporuyla aynı kapsamda uzlaşır", async () => {
    const istatistik = new PlatformIstatistikService({ db } as never);
    const sonuc = await platformBaglamiylaCalistir({ kullaniciId: randomUUID(), eposta: "test@example.invalid", rol: "yonetici" }, () =>
      istatistik.rapor(istatistikFiltreSemasi.parse({ baslangic: "2026-10-01", bitis: "2026-10-02", plan, firma: id })));
    expect(sonuc.odeme.sayilar).toEqual((await rapor()).sayilar);
    expect(Object.keys(sonuc.odeme)).toEqual(["sayilar"]);
  });
  it("eşit zamanlı kayıtlar sayfalar arasında tekrarlanmaz; boş sayfada toplam korunur", async () => {
    const a = await rapor(1), b = await rapor(2), bos = await rapor(100);
    expect(new Set([...a.denemeler, ...b.denemeler].map((x) => x.id)).size).toBe(100);
    expect(bos.toplam).toBe(507); expect(bos.denemeler).toEqual([]);
  });
  it("kiracı rolü kaynağı çağıramaz; geçersiz filtre reddedilir", async () => {
    await expect(app.$queryRaw`SELECT platform_sorunlu_odeme_kapsami('2026-10-01'::date,'2026-10-02'::date,NULL,NULL,'hepsi',1)`).rejects.toThrow();
    await expect(db.$queryRaw`SELECT platform_sorunlu_odeme_kapsami('2026-10-01'::date,'2026-10-02'::date,NULL,NULL,'hepsi',0)`).rejects.toThrow();
  });
});
