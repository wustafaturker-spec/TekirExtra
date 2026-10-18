import { defineConfig } from "vitest/config";

/** Yalnız node scripts/ai-guvenlik-kabul.mjs ile geçici DB'de (AI-52…57). */
export default defineConfig({ test: { include: ["test/ai-guvenlik.kabul.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false, maxWorkers: 1 } });
