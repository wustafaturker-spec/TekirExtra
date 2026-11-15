import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Rol } from "@tekirextra/shared";

/**
 * END-17 kabul testi (gerçek PostgreSQL, uygulama rolü + RLS): kira
 * sözleşmesi ve tekrarlayan faturaya endeksli artış kuralı; artış ayında
 * öneri ve bildirim; onayla kira matrahı / plan çarpanı güncellenir; çarpan
 * üretilen taslağın birim fiyatına olağan güncelleme yolundan uygulanır;
 * başka firma kuralı göremez. Plan özelliği firma kümesiyle taklit edilir.
 */
const planAcik = new Set<string>();
vi.mock("../src/core/abonelik-erisim.service", async (asil) => ({
  ...(await asil<typeof import("../src/core/abonelik-erisim.service")>()),
  planOzelligiAcik: async (_tx: unknown, tenantId: string) => planAcik.has(tenantId),
}));

const { PrismaService } = await import("../src/core/prisma.service");
const { baglamlaCalistir } = await import("../src/core/istek-baglami");
const { BildirimService } = await import("../src/bildirimler/bildirim.service");
const { EndeksArtisService } = await import("../src/fiyat-endeks/endeks-artis.service");
const { FaturaService } = await import("../src/fatura/fatura.service");
const { StokService } = await import("../src/stok/stok.service");
const { DepoService } = await import("../src/stok/depo.service");
const { BelgelerService } = await import("../src/belgeler/belgeler.service");
const { DonemKilidiService } = await import("../src/donem-kapatma/donem-kilidi.service");
const { BaglantilarService } = await import("../src/tenant/baglantilar.service");

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const prisma = new PrismaService();
const artis = new EndeksArtisService(prisma, new BildirimService(prisma));
const harici = new Proxy({}, { get: (_t, k) => () => { throw new Error(`Harici servis çağrılamaz: ${String(k)}`); } }) as never;
const donem = new DonemKilidiService(prisma), depo = new DepoService(prisma);
const fatura = new FaturaService(prisma, new StokService(prisma, harici, depo, donem), depo, harici, harici, new BelgelerService(prisma, harici, depo, donem), donem, new BaglantilarService(prisma), harici, harici);

const SERI = `ARTIS${String(Date.now()).slice(-9)}`;
const A = { tenant: randomUUID(), yonetici: randomUUID(), muhasebe: randomUUID(), satis: randomUUID(), kategori: randomUUID(), kira: randomUUID(), cari: randomUUID(), stok: randomUUID(), sablon: randomUUID(), plan: randomUUID() };
const B = { tenant: randomUUID(), yonetici: randomUUID() };
const ile = <T>(tenantId: string, userId: string, rol: Rol, is: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol }, is);
const ay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const bugun = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const SIMDI = new Date("2026-11-15T09:00:00+03:00");

beforeAll(async () => {
  for (const [f, unvan] of [[A.tenant, "Artış Alfa"], [B.tenant, "Artış Beta"]] as const) {
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${f}::uuid, ${unvan}, ${String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-10)}, now(), now())`;
  }
  for (const [tenant, id, rol] of [[A.tenant, A.yonetici, "yonetici"], [A.tenant, A.muhasebe, "muhasebe"], [A.tenant, A.satis, "satis"], [B.tenant, B.yonetici, "yonetici"]] as const) {
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${id}::uuid, ${tenant}::uuid, ${`artis-${id}@test.local`}, 'x', ${`Artış ${rol}`}, ${rol}::"Rol", now())`;
  }
  // Ekim 2025 = 100, Ekim 2026 = 132,5 → yıllık %32,50.
  await yonetim.endeksSerisi.create({ data: { kod: SERI, evdsKodu: `TP.${SERI}`, ad: "Artış kabul endeksi", tur: "endeks", etkin: false } });
  await yonetim.endeksDegeri.createMany({ data: [{ seriKodu: SERI, donem: ay("2025-10-01"), deger: "100" }, { seriKodu: SERI, donem: ay("2026-10-01"), deger: "132.5" }] });
  await yonetim.masrafKategori.create({ data: { id: A.kategori, tenantId: A.tenant, ad: "Kira" } });
  await yonetim.kiraSozlesme.create({ data: { id: A.kira, tenantId: A.tenant, kategoriId: A.kategori, baslik: "Depo kirası", baslangicTarihi: ay("2025-11-01"), matrah: "10000", aktif: true } });
  await yonetim.cariHesap.create({ data: { id: A.cari, tenantId: A.tenant, kod: "C1", unvan: "Bakım müşterisi", tip: "musteri" } });
  await yonetim.stokKart.create({ data: { id: A.stok, tenantId: A.tenant, kod: "H1", ad: "Bakım hizmeti", tip: "hizmet", anaBirim: "adet" } });
  await yonetim.fatura.create({ data: {
    id: A.sablon, tenantId: A.tenant, cariId: A.cari, tip: "satis", durum: "kesin", tarih: ay("2026-10-01"),
    toplamBrut: "1000", toplamMatrah: "1000", genelToplam: "1200", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamKdv: "200", toplamTevkifat: "0", toplamNetKdv: "200",
    satirlar: { create: [{ tenantId: A.tenant, stokId: A.stok, miktar: "1", birim: "adet", birimFiyat: "1000", matrah: "1000", kdvOrani: "20", kdvTutari: "200", netKdvTutari: "200", toplamTutar: "1200" }] },
  } });
  await yonetim.tekrarlayanFatura.create({ data: { id: A.plan, tenantId: A.tenant, ad: "Aylık bakım", sablonFaturaId: A.sablon, siklik: "aylik", sonrakiTarih: ay("2099-01-01") } });
  planAcik.add(A.tenant);
});

afterAll(async () => {
  await yonetim.tenant.deleteMany({ where: { id: { in: [A.tenant, B.tenant] } } }).catch(() => undefined);
  await yonetim.endeksSerisi.deleteMany({ where: { kod: SERI } }).catch(() => undefined);
  await Promise.all([yonetim.$disconnect(), prisma.$disconnect()]);
});

describe("END-17 endeksli artış", () => {
  it("kural kaydı güncellenir; plan özelliği kapalı firma ve bilinmeyen kayıt reddedilir; önizleme hesaplanır", async () => {
    const kira = await ile(A.tenant, A.muhasebe, "muhasebe", () => artis.kuralKaydet({ kaynakTur: "kira", kaynakId: A.kira, seriKodu: SERI, olcu: "yillik", artisAyi: 11, ustSinir: null, aktif: true }));
    await ile(A.tenant, A.muhasebe, "muhasebe", () => artis.kuralKaydet({ kaynakTur: "tekrarlayan_fatura", kaynakId: A.plan, seriKodu: SERI, olcu: "yillik", artisAyi: 11, ustSinir: "25", aktif: true }));
    // Aynı kayda ikinci kayıt güncellemedir.
    expect((await ile(A.tenant, A.muhasebe, "muhasebe", () => artis.kuralKaydet({ kaynakTur: "kira", kaynakId: A.kira, seriKodu: SERI, olcu: "yillik", artisAyi: 11, ustSinir: null, aktif: true }))).id).toBe(kira.id);
    await expect(ile(B.tenant, B.yonetici, "yonetici", () => artis.kurallar())).rejects.toThrow(/abonelik planınızda açık değil/);
    await expect(ile(A.tenant, A.muhasebe, "muhasebe", () => artis.kuralKaydet({ kaynakTur: "kira", kaynakId: randomUUID(), seriKodu: SERI, olcu: "yillik", artisAyi: 11, ustSinir: null, aktif: true }))).rejects.toThrow(/bulunamadı/);
    const r = await ile(A.tenant, A.yonetici, "yonetici", () => artis.kurallar());
    expect(r.kurallar).toHaveLength(2);
    expect(r.kurallar.find((k) => k.kaynak?.tur === "kira")?.onizleme).toMatchObject({ oran: "32.50", yeniBedel: "13250.00" });
  });

  it("artış ayında öneri üretilir (bir kez), bildirim düşer; pencere dışında üretilmez", async () => {
    expect(await artis.uret(A.tenant, new Date("2026-10-20T09:00:00+03:00"))).toBe(0);
    expect(await artis.uret(A.tenant, SIMDI)).toBe(2);
    expect(await artis.uret(A.tenant, SIMDI)).toBe(0);
    const oneriler = await ile(A.tenant, A.yonetici, "yonetici", () => artis.oneriler("bekliyor"));
    const kira = oneriler.find((o) => o.kaynak?.tur === "kira")!, plan = oneriler.find((o) => o.kaynak?.tur === "tekrarlayan_fatura")!;
    expect(kira).toMatchObject({ yil: 2026, sonAy: "2026-10", hesaplananOran: "32.50", uygulananOran: "32.50", eskiBedel: "10000.00", yeniBedel: "13250.00" });
    expect(plan).toMatchObject({ hesaplananOran: "32.50", uygulananOran: "25.00", eskiBedel: "1000.00", yeniBedel: "1250.00" });
    expect((plan.hesap as { yeniCarpan: string }).yeniCarpan).toBe("1.25000000");
    expect((kira.hesap as { kullanilan: unknown[] }).kullanilan).toEqual([{ ay: "2025-10-01", deger: "100.000000" }, { ay: "2026-10-01", deger: "132.500000" }]);
    expect(await yonetim.bildirim.count({ where: { tenantId: A.tenant, kaynakTur: "endeks_artis_onerisi" } })).toBe(2);
    expect(await ile(B.tenant, B.yonetici, "yonetici", () => prisma.tenantIslem(B.tenant, (tx) => tx.endeksArtisOnerisi.count()))).toBe(0);
  });

  it("onay kira matrahını ve plan çarpanını günceller; karar tekrarlanamaz; bedel değişmişse eskimiş öneri uygulanmaz", async () => {
    const oneriler = await ile(A.tenant, A.yonetici, "yonetici", () => artis.oneriler("bekliyor"));
    const kira = oneriler.find((o) => o.kaynak?.tur === "kira")!, plan = oneriler.find((o) => o.kaynak?.tur === "tekrarlayan_fatura")!;
    // Öneriden sonra kira elle değişti → onay reddedilir, matrah korunur.
    await yonetim.kiraSozlesme.update({ where: { id: A.kira }, data: { matrah: "11000" } });
    await expect(ile(A.tenant, A.muhasebe, "muhasebe", () => artis.karar(kira.id, "onaylandi"))).rejects.toThrow(/değişmiş/);
    await yonetim.kiraSozlesme.update({ where: { id: A.kira }, data: { matrah: "10000" } });
    await ile(A.tenant, A.muhasebe, "muhasebe", () => artis.karar(kira.id, "onaylandi"));
    expect((await yonetim.kiraSozlesme.findUniqueOrThrow({ where: { id: A.kira } })).matrah.toFixed(2)).toBe("13250.00");
    await expect(ile(A.tenant, A.muhasebe, "muhasebe", () => artis.karar(kira.id, "reddedildi"))).rejects.toThrow(/karar verilmiş/);
    await ile(A.tenant, A.muhasebe, "muhasebe", () => artis.karar(plan.id, "onaylandi"));
    expect((await yonetim.tekrarlayanFatura.findUniqueOrThrow({ where: { id: A.plan } })).fiyatCarpani.toFixed(8)).toBe("1.25000000");
    // Karar verilmiş önerinin hesabı DB'de de değişmez.
    await expect(yonetim.endeksArtisOnerisi.update({ where: { id: kira.id }, data: { durum: "bekliyor" } })).rejects.toThrow(/değiştirilemez/);
  });

  it("çarpanlı plandan üretilen taslak artışlı birim fiyat ve yeniden hesaplanmış toplamla açılır; şablon değişmez", async () => {
    await yonetim.tekrarlayanFatura.update({ where: { id: A.plan }, data: { sonrakiTarih: ay(bugun()) } });
    const r = await ile(A.tenant, A.muhasebe, "muhasebe", () => fatura.vadesiGelenleriUret());
    expect(r.fiyatUyarilari).toEqual([]);
    expect(r.faturaIds).toHaveLength(1);
    const taslak = await yonetim.fatura.findUniqueOrThrow({ where: { id: r.faturaIds[0] }, include: { satirlar: true } });
    expect([taslak.durum, taslak.satirlar[0].birimFiyat.toFixed(2), taslak.toplamMatrah.toFixed(2), taslak.genelToplam.toFixed(2)]).toEqual(["taslak", "1250.00", "1250.00", "1500.00"]);
    expect((await yonetim.faturaSatir.findFirstOrThrow({ where: { faturaId: A.sablon } })).birimFiyat.toFixed(2)).toBe("1000.00");
  });
});
