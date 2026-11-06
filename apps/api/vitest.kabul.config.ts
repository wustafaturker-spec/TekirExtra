import { defineConfig } from "vitest/config";

/**
 * Kabul testleri (ISTERLER §6): gerçek PostgreSQL, Redis, MinIO ve Chromium
 * gerekir — `docker compose up -d postgres redis mailpit minio` ile ayağa
 * kaldırılır. Senaryolar sırayla ve tek dosyada koşar; her koşu kendi
 * kiracılarını açar.
 *
 * Testler pilotla ortak geliştirme veritabanına DOKUNMAZ (2026-11-06): aynı
 * sunucuda ayrı `<db>_kabul` veritabanı, Redis'te ayrı mantıksal veritabanı ve
 * ayrı kova kullanılır (`test/kabul-ortami.ts`). Kabul veritabanı koşu başında
 * oluşturulur ve migration'ları uygulanır; `KABUL_SIFIRLA=1` baştan kurar.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.kabul.test.ts"],
    globalSetup: ["./vitest.kabul.hazirlik.ts"],
    setupFiles: ["./vitest.kabul.kurulum.ts"],
    // Commit gerektiren yarışlar yalnız kendi geçici PostgreSQL runner'ında çalışır.
    exclude: ["test/crm-belge.kabul.test.ts", "test/maliyet-yaris.kabul.test.ts", "test/odeme-sozu.kabul.test.ts", "test/tahsilat-takibi.kabul.test.ts",
      "test/odeme-sozu-hatirlatma.kabul.test.ts", "test/ihtiyac.kabul.test.ts", "test/crm-http.kabul.test.ts",
      // Kendi betiğiyle (geçici konteyner / aday dist) koşanlar: scripts/ai-guvenlik-kabul.mjs, scripts/f01-yaris-kabul.mjs --f02-yayin.
      "test/ai-guvenlik.kabul.test.ts", "test/f02-yayin.kabul.test.ts",
      // F04 izole runner'ları: her biri kendi vitest.<ad>.config.ts ve scripts/f04-* betiğiyle koşar.
      "test/ebelge-rezervasyon.kabul.test.ts", "test/ihtiyac-gecis.kabul.test.ts", "test/ihtiyac-http.kabul.test.ts", "test/ihtiyac-ileri.kabul.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
