import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['test/ihtiyac-http.kabul.test.ts'],testTimeout:120000,hookTimeout:180000,fileParallelism:false,maxWorkers:1}});
