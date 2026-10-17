import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/crm-belge.kabul.test.ts"], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, maxWorkers: 1 } });
