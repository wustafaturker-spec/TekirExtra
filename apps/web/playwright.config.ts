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
const imzali = (tur: string) => `${tur}.${bitis}.${createHmac("sha256", sir ?? "").update(`${tur}.${bitis}`).digest("base64url")}`;
// PLT-08: /platform sayfaları ayrı `tekir_platform_oturum` (p1) işareti ister.
const oturumCerezi = sir && sir.length >= 32
  ? [["tekir_oturum", "v1"], ["tekir_platform_oturum", "p1"]].map(([name, tur]) => ({ name, value: imzali(tur), domain: "localhost", path: "/", expires: bitis, httpOnly: true, secure: false, sameSite: "Lax" as const }))
  : [];

/**
 * Kendi kökenine (127.0.0.1:310x) bağlı testler yalnız kendi yapılandırmalarıyla koşar; burada
 * localhost:3100'de her ortamda düşerler. testIgnore değil testMatch: bu dosyayı genişleten
 * yapılandırmalar testMatch'i kendi dosyalarıyla ezer, testIgnore ise onlara da miras kalırdı.
 */
const AYRI_KOKENLI = ["ekstre-yukleme", "maliyet-eksikleri", "odeme-sozu", "tahsilat-takibi"];
const varsayilanTestler = new RegExp(`^(?!.*[\\\\/](${AYRI_KOKENLI.join("|")})\\.spec\\.ts$).*\\.spec\\.ts$`);

export default defineConfig({
  testDir: "./e2e",
  testMatch: varsayilanTestler,
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100, stylePath: "./e2e/ekran-goruntusu.css" },
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
  // CI web'i önceden derler; derlenmiş uygulamada ilk gezinme derlemesi ve dev sunucusunun
  // bellek eşiğinde kendini yeniden başlatması olmaz (uzun koşuda 30-50 sn'lik duraklamalar).
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3100/giris",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
