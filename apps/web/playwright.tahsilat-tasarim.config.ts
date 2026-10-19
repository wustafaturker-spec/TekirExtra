import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
const web = process.env.TAHSILAT_TEST_WEB_ROOT;
if (!web) throw new Error("TAHSILAT_TEST_WEB_ROOT ile standalone paketini belirtin");
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const secret = "tahsilat-tasarim-izole-oturum-anahtari-20261019";
const body = `v1.${Math.floor(Date.now() / 1000) + 3600}`;
const cases = [{ port: 3105, file: "odeme-sozu.spec.ts", name: "cari-sozler" }, { port: 3106, file: "tahsilat-takibi.spec.ts", name: "takip-akislari" }, { port: Number(process.env.TAHSILAT_TASARIM_TEST_PORT ?? 3111), file: "tahsilat-soz-is-listesi.spec.ts", name: "yeni-tasarim" }];
const evidence = resolve(__dirname, process.env.TAHSILAT_TEST_EVIDENCE ?? "../../.release-candidates/pilot-yayin-20261019/tasarim-qa");
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false, retries: 0, timeout: 120000, expect: { timeout: 15000 },
  outputDir: evidence + "/artifacts", reporter: [["list"], ["json", { outputFile: evidence + "/sonuc.json" }]],
  use: { channel: "chrome", trace: "retain-on-failure", storageState: { origins: [], cookies: [{ name: "tekir_oturum", value: `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }] } },
  projects: cases.map(c => ({ name: c.name, testMatch: c.file, use: { baseURL: `http://127.0.0.1:${c.port}` } })),
  webServer: cases.map(c => ({ command: `node ${quote(web + "/server.js")}`, env: { NODE_ENV: "production", OTURUM_ISARETI_SECRET: secret, PORT: String(c.port), HOSTNAME: "127.0.0.1", NODE_OPTIONS: "--max-old-space-size=768" }, url: `http://127.0.0.1:${c.port}/giris`, reuseExistingServer: false, timeout: 90000 })),
});
