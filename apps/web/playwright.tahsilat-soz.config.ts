import { defineConfig } from "@playwright/test";
import { createHmac } from "node:crypto";
const standalone = process.env.TAHSILAT_TEST_WEB_ROOT;
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const secret = "tahsilat-tasarim-izole-oturum-anahtari-20261019";
const body = `v1.${Math.floor(Date.now() / 1000) + 3600}`;
export default defineConfig({ testDir: "./e2e", testMatch: "tahsilat-soz-is-listesi.spec.ts", workers: 1, timeout: 120000, expect: { timeout: 30000 }, use: { baseURL: "http://127.0.0.1:3111", channel: "chrome", storageState: { origins: [], cookies: [{ name: "tekir_oturum", value: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }] } }, webServer: { command: standalone ? `node ${shellQuote(standalone + "/server.js")}` : "pnpm exec next dev -H 127.0.0.1 -p 3111", env: { NEXT_DIST_DIR: ".next-tahsilat-soz-e2e", OTURUM_ISARETI_SECRET: secret, PORT: "3111", HOSTNAME: "127.0.0.1" }, url: "http://127.0.0.1:3111/giris", reuseExistingServer: false, timeout: 180000 } });
