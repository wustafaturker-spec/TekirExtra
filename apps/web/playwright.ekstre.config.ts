import { defineConfig } from '@playwright/test';
import temel from './playwright.config';

const dist = process.env.EKSTRE_TEST_DIST;
export default defineConfig({
  ...temel,
  testMatch: 'ekstre-yukleme.spec.ts',
  use: { ...temel.use, baseURL: 'http://127.0.0.1:3103' },
  webServer: {
    command: `pnpm exec next ${dist ? 'start' : 'dev'} -H 127.0.0.1 -p 3103`,
    env: { NEXT_DIST_DIR: dist ?? '.next-ekstre-e2e' },
    url: 'http://127.0.0.1:3103/giris', reuseExistingServer: false, timeout: 120000,
  },
});
