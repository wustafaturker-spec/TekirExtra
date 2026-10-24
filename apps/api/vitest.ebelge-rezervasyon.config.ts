import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['test/ebelge-rezervasyon.kabul.test.ts'],testTimeout:45000,hookTimeout:30000,fileParallelism:false,maxWorkers:1}});
