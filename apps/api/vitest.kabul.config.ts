import { defineConfig } from "vitest/config";

/**
 * Kabul testleri (ISTERLER §6): gerçek PostgreSQL, Redis, MinIO ve Chromium
 * gerekir — `docker compose up -d postgres redis mailpit minio` ile ayağa
 * kaldırılır. Senaryolar sırayla ve tek dosyada koşar; her koşu kendi
 * kiracılarını açtığı için veritabanı temizliği gerektirmez.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.kabul.test.ts"],
    // Commit gerektiren yarışlar yalnız kendi geçici PostgreSQL runner'ında çalışır.
    exclude: ["test/crm-belge.kabul.test.ts", "test/maliyet-yaris.kabul.test.ts", "test/odeme-sozu.kabul.test.ts", "test/tahsilat-takibi.kabul.test.ts",
      // Kendi betiğiyle (geçici konteyner / aday dist) koşanlar: scripts/ai-guvenlik-kabul.mjs, scripts/f01-yaris-kabul.mjs --f02-yayin.
      "test/ai-guvenlik.kabul.test.ts", "test/f02-yayin.kabul.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
