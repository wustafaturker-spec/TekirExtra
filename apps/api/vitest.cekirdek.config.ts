import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["test/maliyet-yaris.kabul.test.ts","test/odeme-sozu.kabul.test.ts","test/tahsilat-takibi.kabul.test.ts","test/crm-belge.kabul.test.ts","test/f02-yayin.kabul.test.ts","test/crm-http.kabul.test.ts"],testTimeout:180000,hookTimeout:30000,fileParallelism:false,maxWorkers:1}});
