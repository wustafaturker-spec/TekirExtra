import { defineConfig } from "@playwright/test";
import temel from "./playwright.config";
export default defineConfig({
  ...temel,
  testMatch: "cek-ocr-vade.spec.ts",
  use: { ...temel.use, baseURL: "http://localhost:3102" },
  webServer: {
    command: "NEXT_DIST_DIR=.next-cek-e2e pnpm exec next dev -p 3102",
    url: "http://localhost:3102/giris", reuseExistingServer: false, timeout: 120000,
  },
});
