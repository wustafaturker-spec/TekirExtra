import { defineConfig } from "@playwright/test";
import temel from "./playwright.config";
const dist = process.env.F02_TEST_DIST;
export default defineConfig({
  ...temel, testMatch: "odeme-sozu.spec.ts", use: { ...temel.use, baseURL: "http://127.0.0.1:3105" },
  webServer: { command: `pnpm exec next ${dist ? "start" : "dev"} -H 127.0.0.1 -p 3105`, env: { NEXT_DIST_DIR: dist ?? ".next-f02-e2e" }, url: "http://127.0.0.1:3105/giris", reuseExistingServer: false, timeout: 120000 },
});
