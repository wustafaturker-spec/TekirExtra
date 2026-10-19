import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["test/crm-http.kabul.test.ts"],testTimeout:180000,hookTimeout:30000,fileParallelism:false,maxWorkers:1}});
