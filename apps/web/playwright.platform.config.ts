import { defineConfig } from "@playwright/test";
import { createHmac } from "node:crypto";
import temel from "./playwright.config";

const sir = "platform-playwright-yalitilmis-oturum-sirri-2026";
const bitis = Math.floor(Date.now() / 1000) + 3600;
const deger = (tur: string) => `${tur}.${bitis}.${createHmac("sha256", sir).update(`${tur}.${bitis}`).digest("base64url")}`;

/** Çalışan pilotu değiştirmeden güncel kaynakla platform kabulü. */
export default defineConfig({
  ...temel,
  testMatch: /(?:platform-.*|critical-workflows)\.spec\.ts$/,
  use: {
    ...temel.use, baseURL: "http://localhost:3112", channel: "chromium",
    storageState: { cookies: [["tekir_platform_oturum", "p1"], ["tekir_oturum", "v1"]].map(([name, tur]) => ({ name, value: deger(tur), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" as const, expires: bitis })), origins: [] },
  },
  webServer: {
    command: "pnpm exec next dev -H 127.0.0.1 -p 3112",
    env: { NEXT_DIST_DIR: ".next-platform-e2e", NODE_OPTIONS: "--max-old-space-size=2560", OTURUM_ISARETI_SECRET: sir },
    url: "http://localhost:3112/giris", reuseExistingServer: false, timeout: 240000,
  },
});
