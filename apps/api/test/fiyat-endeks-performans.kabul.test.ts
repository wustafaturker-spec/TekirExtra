import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * END-25 ölçümü (gerçek PostgreSQL). Yalnız FIYAT_ENDEKS_PERF=1 ile çalışır:
 * 5.000 ürün, 24 ay, ~360.000 kesin fatura satırı ve ayda 60 satırlı yoğun
 * bir ürün kurar; tek ürün ekranını (24 ay, iki endeks, alış ve ek çizgiler)
 * ve toplu raporu zamanlar. Veri kendi firmasındadır ve sonda silinir.
 */
const ACIK = process.env.FIYAT_ENDEKS_PERF === "1";
const planAcik = new Set<string>();
vi.mock("../src/core/abonelik-erisim.service", async (asil) => ({
  ...(await asil<typeof import("../src/core/abonelik-erisim.service")>()),
  planOzelligiAcik: async (_tx: unknown, tenantId: string) => planAcik.has(tenantId),
}));

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const T = randomUUID(), U = randomUUID(), YOGUN = randomUUID();
const SERI = `PERF${String(Date.now()).slice(-9)}`;
const URUN = 5000, AY = 24, FATURA_AYDA = 5000, SATIR = 3;
const sure = async (is: () => Promise<unknown>) => { const t = performance.now(); await is(); return Math.round(performance.now() - t); };
const medyan = (l: number[]) => [...l].sort((a, b) => a - b)[Math.floor(l.length / 2)];

describe.skipIf(!ACIK)("END-25 performans — gerçek PostgreSQL", () => {
  let servis: InstanceType<typeof import("../src/fiyat-endeks/fiyat-endeks.service").FiyatEndeksService>;
  let ile: <R>(is: () => Promise<R>) => Promise<R>;
  let prisma: InstanceType<typeof import("../src/core/prisma.service").PrismaService>;
  let rapor: (filtreler: Record<string, string>) => Promise<unknown[]>;

  beforeAll(async () => {
    const { PrismaService } = await import("../src/core/prisma.service");
    const { baglamlaCalistir } = await import("../src/core/istek-baglami");
    const { FiyatEndeksService } = await import("../src/fiyat-endeks/fiyat-endeks.service");
    const { raporTanimiAl } = await import("../src/core/raporlar/rapor-kayit");
    await import("../src/fiyat-endeks/fiyat-endeks.raporlar");
    prisma = new PrismaService();
    servis = new FiyatEndeksService(prisma);
    ile = (is) => baglamlaCalistir({ tenantId: T, userId: U, rol: "yonetici" }, is);
    rapor = (filtreler) => ile(() => prisma.tenantIslem(T, (tx) => raporTanimiAl("stok.fiyat_endeks")!.calistir({ filtreler }, { tenantId: T, tx }), { timeout: 600_000 }));

    const t0 = performance.now();
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${T}::uuid, 'Performans firması', ${String(Date.now()).slice(-10)}, now(), now())`;
    await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${U}::uuid, ${T}::uuid, ${`perf-${U}@test.local`}, 'x', 'Perf', 'yonetici'::"Rol", now())`;
    await yonetim.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, updated_at) SELECT gen_random_uuid(), ${T}::uuid, 'C' || g, 'Cari ' || g, 'musteri', now() FROM generate_series(1, 50) g`;
    await yonetim.$executeRaw`INSERT INTO stok_kartlari (id, tenant_id, kod, ad, ana_birim, updated_at) SELECT gen_random_uuid(), ${T}::uuid, 'P' || lpad(g::text, 5, '0'), 'Ürün ' || g, 'adet', now() FROM generate_series(1, ${URUN}) g`;
    await yonetim.$executeRaw`INSERT INTO stok_kartlari (id, tenant_id, kod, ad, ana_birim, updated_at) VALUES (${YOGUN}::uuid, ${T}::uuid, 'YOGUN', 'Yoğun ürün', 'adet', now())`;
    // Her ay FATURA_AYDA satış faturası, her birinde SATIR rastgele ürün; yarısı alış.
    const toplu = [`
      WITH c AS (SELECT array_agg(id) a FROM cari_hesaplar WHERE tenant_id = '${T}'),
      s AS (SELECT array_agg(id) a FROM stok_kartlari WHERE tenant_id = '${T}' AND kod <> 'YOGUN'),
      f AS (
        INSERT INTO faturalar (id, tenant_id, cari_id, tip, durum, tarih, toplam_brut, toplam_matrah, genel_toplam, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_kdv, toplam_tevkifat, toplam_net_kdv, updated_at)
        SELECT gen_random_uuid(), '${T}', c.a[1 + (g % 50)], CASE WHEN g % 2 = 0 THEN 'satis' ELSE 'alis' END::"FaturaTip", 'kesin',
          (date '2024-11-01' + (m || ' month')::interval + ((g % 27) || ' day')::interval)::date, 300, 300, 360, 0, 0, 60, 0, 60, now()
        FROM generate_series(0, ${AY - 1}) m, generate_series(1, ${FATURA_AYDA}) g, c
        RETURNING id, tenant_id)
      INSERT INTO fatura_satirlari (id, tenant_id, fatura_id, stok_id, miktar, birim, birim_fiyat, matrah, kdv_tutari, net_kdv_tutari, toplam_tutar)
      SELECT gen_random_uuid(), f.tenant_id, f.id, s.a[1 + floor(random() * ${URUN})::int], 1 + floor(random() * 10), 'adet', 100, 100 + floor(random() * 50), 20, 20, 120
      FROM f, generate_series(1, ${SATIR}) k, s`,
    // Yoğun ürün: ayda 60 satış satırı.
    `
      WITH c AS (SELECT (array_agg(id))[1] id FROM cari_hesaplar WHERE tenant_id = '${T}'),
      f AS (
        INSERT INTO faturalar (id, tenant_id, cari_id, tip, durum, tarih, toplam_brut, toplam_matrah, genel_toplam, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_kdv, toplam_tevkifat, toplam_net_kdv, updated_at)
        SELECT gen_random_uuid(), '${T}', c.id, 'satis', 'kesin', (date '2024-11-01' + (m || ' month')::interval + ((g % 27) || ' day')::interval)::date, 100, 100, 120, 0, 0, 20, 0, 20, now()
        FROM generate_series(0, ${AY - 1}) m, generate_series(1, 60) g, c RETURNING id, tenant_id)
      INSERT INTO fatura_satirlari (id, tenant_id, fatura_id, stok_id, miktar, birim, birim_fiyat, matrah, kdv_tutari, net_kdv_tutari, toplam_tutar)
      SELECT gen_random_uuid(), f.tenant_id, f.id, '${YOGUN}', 2, 'adet', 50, 100 + floor(random() * 20), 20, 20, 120 FROM f`];
    // Ölçüm verisi kurulumu: satır başına firma bağı tetikleyicileri (5 adet) 360.000 satırda
    // dakikalar sürüyor; veri burada tutarlı üretildiği için yalnız bu işlemde kapatılır.
    await yonetim.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const q of toplu) await tx.$executeRawUnsafe(q);
    }, { timeout: 1_200_000, maxWait: 60_000 });
    await yonetim.endeksSerisi.create({ data: { kod: SERI, evdsKodu: `TP.${SERI}`, ad: "Perf endeksi", tur: "endeks", etkin: false } });
    await yonetim.$executeRawUnsafe(`INSERT INTO endeks_degerleri (seri_kodu, donem, deger) SELECT '${SERI}', (date '2023-11-01' + (m || ' month')::interval)::date, 100 + m FROM generate_series(0, 40) m`);
    for (const tablo of ["faturalar", "fatura_satirlari", "stok_kartlari"]) await yonetim.$executeRawUnsafe(`ANALYZE ${tablo}`);
    planAcik.add(T);
    const satir = await yonetim.faturaSatir.count({ where: { tenantId: T } });
    console.log(`[perf] veri hazır: ${satir} satır, ${Math.round((performance.now() - t0) / 1000)} sn`);
  }, 1_800_000);

  afterAll(async () => {
    if (!ACIK) return;
    // Kurulumdaki gibi satır başı tetikleyiciler kapalı tek işlemde; açıkken 360.000 satır silmek dakikalar sürüyor.
    await yonetim.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const tablo of ["fatura_satirlari", "faturalar", "stok_kartlari", "cari_hesaplar", "users"]) await tx.$executeRawUnsafe(`DELETE FROM ${tablo} WHERE tenant_id = '${T}'`);
    }, { timeout: 600_000, maxWait: 60_000 });
    await yonetim.tenant.deleteMany({ where: { id: T } });
    for (const tablo of ["faturalar", "fatura_satirlari", "stok_kartlari"]) await yonetim.$executeRawUnsafe(`VACUUM ANALYZE ${tablo}`);
    await yonetim.endeksSerisi.deleteMany({ where: { kod: SERI } });
    await Promise.all([yonetim.$disconnect(), prisma?.$disconnect()]);
  }, 600_000);

  it("tek ürün ekranı 24 ay, iki endeks, alış ve ek çizgilerle 1 sn altında", async () => {
    const sorgu = { baslangic: "2024-11", bitis: "2026-10", endeksler: [SERI, "USD"], satisKapsami: "tum" as const, listeler: [], alis: true, cizgiler: ["liste", "maliyet", "sonAlis"] as ("liste" | "maliyet" | "sonAlis")[] };
    const ornek = (await yonetim.stokKart.findFirstOrThrow({ where: { tenantId: T, kod: "P00042" } })).id;
    await ile(() => servis.urun(YOGUN, sorgu)); // ısınma
    const yogun: number[] = [], olagan: number[] = [];
    for (let i = 0; i < 8; i++) { yogun.push(await sure(() => ile(() => servis.urun(YOGUN, sorgu)))); olagan.push(await sure(() => ile(() => servis.urun(ornek, sorgu)))); }
    console.log(`[perf] tek ürün medyan: yoğun ${medyan(yogun)} ms, olağan ${medyan(olagan)} ms (${yogun.join(",")} / ${olagan.join(",")})`);
    expect(medyan(yogun)).toBeLessThan(1000);
    expect(medyan(olagan)).toBeLessThan(1000);
  }, 600_000);

  it("toplu rapor 5.000 ürün 24 ay süresi ölçülür", async () => {
    let satirlar: unknown[] = [];
    const ms = await sure(async () => { satirlar = await rapor({ baslangic: "2024-11-01", bitis: "2026-10-31", endeks: SERI, taraf: "satis" }); });
    console.log(`[perf] toplu rapor: ${satirlar.length} ürün, ${ms} ms`);
    expect(satirlar.length).toBeGreaterThan(4900);
  }, 900_000);
});
