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
 * ana yapılandırmanın kökeninde (localhost:${E2E_PORT}) her ortamda düşerler. testIgnore değil testMatch: bu dosyayı genişleten
 * yapılandırmalar testMatch'i kendi dosyalarıyla ezer, testIgnore ise onlara da miras kalırdı.
 */
const AYRI_KOKENLI = ["ekstre-yukleme", "maliyet-eksikleri", "odeme-sozu", "tahsilat-takibi"];
const varsayilanTestler = new RegExp(`^(?!.*[\\\\/](${AYRI_KOKENLI.join("|")})\\.spec\\.ts$).*\\.spec\\.ts$`);

/**
 * Testler pilotun 3100'deki docker web'ini DEĞİL, çalışma ağacının kendi dev
 * sunucusunu sınar (2026-11-06): ayrı port, ayrı dağıtım klasörü ve var olan
 * sunucu yeniden kullanılmaz. API taklit edildiği için veritabanına hiçbir şey
 * gitmez; varsayılan işleyici tanımadığı isteği `{}` ile karşılar.
 */
const E2E_PORT = Number(process.env.E2E_PORT || 3110);
// Web sunucusu genel kurulumdan önce açılır ve next-env.d.ts'i yeniden yazar; asıl içerik burada saklanır.
if (process.env.E2E_NEXT_ENV_ILK === undefined && existsSync("next-env.d.ts")) {
  process.env.E2E_NEXT_ENV_ILK = Buffer.from(readFileSync("next-env.d.ts")).toString("base64");
}
if (E2E_PORT === 3100) throw new Error("E2E_PORT 3100 olamaz: 3100 pilotun docker web'idir");

export default defineConfig({
  testDir: "./e2e",
  testMatch: varsayilanTestler,
  // Next dev'in yeniden yazdığı next-env.d.ts koşu sonunda geri yüklenir.
  globalSetup: "./e2e/genel-kurulum.ts",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100, stylePath: "./e2e/ekran-goruntusu.css" },
  },
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // Google Chrome kurulu değilse `E2E_KANAL=chromium` Playwright'ın kendi Chromium'unu kullanır.
    ...(process.env.E2E_KANAL === "chromium" ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
    storageState: { cookies: oturumCerezi, origins: [] },
  },
  // CI web'i önceden derler; derlenmiş uygulamada ilk gezinme derlemesi ve dev sunucusunun
  // bellek eşiğinde kendini yeniden başlatması olmaz (uzun koşuda 30-50 sn'lik duraklamalar).
  webServer: {
    command: process.env.CI ? `pnpm exec next start -p ${E2E_PORT}` : `NEXT_DIST_DIR=.next-e2e pnpm exec next dev -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/giris`,
    // Yalnız açıkça istenirse (E2E_REUSE=1) o porttaki sunucu yeniden kullanılır.
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
  },
});
