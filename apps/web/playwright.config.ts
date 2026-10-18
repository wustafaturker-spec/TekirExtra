import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Rota koruması (middleware) imzalı `tekir_oturum` çerezi ister; testler API'yi taklit ettiği için
 * çerezi kimse koymaz. Sır tanımlıysa (ortam ya da dev sunucusunun okuduğu .env.local) her teste
 * geçerli bir çerez verilir; tanımsızsa geliştirmede koruma zaten kapalıdır.
 */
function oturumSirri(): string | undefined {
  if (process.env.OTURUM_ISARETI_SECRET) return process.env.OTURUM_ISARETI_SECRET.trim();
  if (!existsSync(".env.local")) return undefined;
  return /^OTURUM_ISARETI_SECRET=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1]?.trim().replace(/^["']|["']$/g, "");
}
const sir = oturumSirri();
const bitis = Math.floor(Date.now() / 1000) + 24 * 3600;
const oturumCerezi = sir && sir.length >= 32
  ? [{ name: "tekir_oturum", value: `v1.${bitis}.${createHmac("sha256", sir).update(`v1.${bitis}`).digest("base64url")}`, domain: "localhost", path: "/", expires: bitis, httpOnly: true, secure: false, sameSite: "Lax" as const }]
  : [];

export default defineConfig({
  testDir: "./e2e",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    channel: "chrome",
    trace: "retain-on-failure",
    storageState: { cookies: oturumCerezi, origins: [] },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3100/giris",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
