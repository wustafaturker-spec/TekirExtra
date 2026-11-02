import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Kiracı yalıtımı kapsaması (MIMARI §3, KLN-06).
 *
 * `tenant_id` sütunu olan her tabloda RLS açık, FORCE'lu ve en az bir
 * politikalı olmalıdır. 2026-09-13 denetiminde 17 tablo yalıtımsız bulundu:
 * yarım kalıp "uygulandı" işaretlenen bir geçiş RLS satırlarını atlamış,
 * bazı geçişler RLS'yi hiç yazmamıştı. Test canlı katalogdan okur; geçiş
 * dosyasına değil veritabanının gerçek durumuna bakar.
 */

/**
 * Kiracı bağlamı kurulmadan kullanılan kimlik tabloları (MIMARI §3).
 * `mevzuat_talepleri` (MVZ-09/10) platform tablosudur: `tenant_id` yalnız
 * bildirimi gönderen kiracıyı not eder; uygulama rolünün bu tabloda yalnız
 * INSERT yetkisi vardır, okuyamaz (yetki migration 20261009120000'de).
 */
const BILINCLI_ISTISNALAR = new Set(["auth_kimlikler", "oturumlar", "eposta_dogrulamalar", "parola_sifirlamalar", "eposta_degisimleri", "mevzuat_talepleri"]);

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL,
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("kiracı yalıtımı — RLS kapsaması", () => {
  it("tenant_id sütunlu her tabloda RLS, FORCE ve politika vardır", async () => {
    const tablolar = await prisma.$queryRaw<{ tablo: string; rls: boolean; force: boolean; politika: bigint }[]>`
      SELECT c.relname AS tablo,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS force,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politika
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns k
          WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id'
        )
      ORDER BY c.relname`;

    // Katalog boş dönerse test yanlış veritabanına bakıyordur; sessizce geçmesin.
    expect(tablolar.length).toBeGreaterThan(50);

    const eksikler = tablolar
      .filter((t) => !BILINCLI_ISTISNALAR.has(t.tablo))
      .filter((t) => !t.rls || !t.force || Number(t.politika) === 0)
      .map((t) => `${t.tablo} (rls=${t.rls}, force=${t.force}, politika=${t.politika})`);

    expect(eksikler).toEqual([]);
  });

  it("kiracılı tablolar arasındaki her yabancı anahtar kiracı bağı denetiminden geçer", async () => {
    // Bileşik anahtarlar tenant_id içerdiği için kendiliğinden güvenlidir; onlar da burada doğrulanır.
    const anahtarlar = await prisma.$queryRaw<{ tablo: string; sutun: string; bilesik: boolean; tenantli: boolean; tetikleyici: boolean }[]>`
      SELECT c.relname AS tablo, a.attname AS sutun, array_length(k.conkey, 1) > 1 AS bilesik,
             EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = k.conrelid AND t.attname = 'tenant_id' AND t.attnum = ANY (k.conkey)) AS tenantli,
             EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc f ON f.oid = g.tgfoid
                     WHERE g.tgrelid = k.conrelid AND f.proname = 'kiraci_bag_denetle' AND NOT g.tgisinternal AND g.tgenabled = 'O' AND a.attnum = ANY (g.tgattr::int2[])) AS tetikleyici
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND n.nspname = 'public'
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = k.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = k.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)`;
    expect(anahtarlar.length).toBeGreaterThan(300);
    const eksikler = anahtarlar.filter((k) => (k.bilesik ? !k.tenantli : !k.tetikleyici)).map((k) => `${k.tablo}.${k.sutun}`);
    expect(eksikler).toEqual([]);
  });

  it("istisna listesi yalnız gerçekten var olan tabloları içerir", async () => {
    const mevcut = await prisma.$queryRaw<{ tablo: string }[]>`
      SELECT table_name AS tablo FROM information_schema.tables WHERE table_schema = 'public'`;
    const adlar = new Set(mevcut.map((t) => t.tablo));
    for (const istisna of BILINCLI_ISTISNALAR) expect(adlar.has(istisna)).toBe(true);
  });
});
