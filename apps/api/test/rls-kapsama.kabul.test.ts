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

  it("istisna listesi yalnız gerçekten var olan tabloları içerir", async () => {
    const mevcut = await prisma.$queryRaw<{ tablo: string }[]>`
      SELECT table_name AS tablo FROM information_schema.tables WHERE table_schema = 'public'`;
    const adlar = new Set(mevcut.map((t) => t.tablo));
    for (const istisna of BILINCLI_ISTISNALAR) expect(adlar.has(istisna)).toBe(true);
  });
});
