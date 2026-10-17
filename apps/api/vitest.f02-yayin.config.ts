import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/odeme-sozu.kabul.test.ts", "test/tahsilat-takibi.kabul.test.ts", "test/f02-yayin.kabul.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, maxWorkers: 1 } });
