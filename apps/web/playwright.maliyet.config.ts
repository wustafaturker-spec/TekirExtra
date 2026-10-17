import { defineConfig } from "@playwright/test";
import temel from "./playwright.config";

const dist = process.env.F01_TEST_DIST;
export default defineConfig({
  ...temel,
  testMatch: "maliyet-eksikleri.spec.ts",
  use: { ...temel.use, baseURL: "http://127.0.0.1:3104" },
  webServer: {
    command: `pnpm exec next ${dist ? "start" : "dev"} -H 127.0.0.1 -p 3104`,
    env: { NEXT_DIST_DIR: dist ?? ".next-f01-e2e" },
    url: "http://127.0.0.1:3104/giris", reuseExistingServer: false, timeout: 120000,
  },
});
