import { defineConfig } from "@playwright/test";
import temel from "./playwright.geciken-soz.config";
const dist = process.env.F02_BILDIRIM_DIST;
export default defineConfig({ ...temel, testMatch: ["geciken-soz.spec.ts", "tahsilat-takibi.spec.ts", "tahsilat-bildirim.spec.ts"],
  webServer: { command: `pnpm exec next ${dist ? "start" : "dev"} -H 127.0.0.1 -p 3106`, env: { NEXT_DIST_DIR: dist ?? ".next-f02-e2e" }, url: "http://127.0.0.1:3106/giris", reuseExistingServer: false, timeout: 120000 },
});
