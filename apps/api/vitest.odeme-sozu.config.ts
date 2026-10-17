import { defineConfig } from "vitest/config";

/** Yalnız node scripts/f01-yaris-kabul.mjs --f02 ile geçici DB'de. */
export default defineConfig({ test: { include: ["test/odeme-sozu.kabul.test.ts", "test/tahsilat-takibi.kabul.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, maxWorkers: 1 } });
