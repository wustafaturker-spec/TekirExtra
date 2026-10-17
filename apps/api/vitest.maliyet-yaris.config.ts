import { defineConfig } from "vitest/config";

/** node scripts/f01-yaris-kabul.mjs; DATABASE_URL ile çalıştırılmaz. */
export default defineConfig({
  test: {
    include: ["test/maliyet-yaris.kabul.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
