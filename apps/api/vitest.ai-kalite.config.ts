import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.eval.test.ts"], fileParallelism: false, testTimeout: 150_000 } });
