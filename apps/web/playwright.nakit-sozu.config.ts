import { defineConfig } from "@playwright/test";
import temel from "./playwright.config";
const dist = process.env.F02_NAKIT_DIST;
export default defineConfig({
  ...temel,
  testMatch: "nakit-sozu.spec.ts",
  use: { ...temel.use, baseURL: "http://127.0.0.1:3107" },
  webServer: {
    command: `pnpm exec next ${dist ? "start" : "dev"} -H 127.0.0.1 -p 3107`,
    env: { NEXT_DIST_DIR: dist ?? ".next-f02-e2e" },
    url: "http://127.0.0.1:3107/giris", reuseExistingServer: false, timeout: 120000,
  },
});
