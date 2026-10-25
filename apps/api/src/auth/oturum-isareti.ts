import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Rota koruması için oturum işareti: web'in Next middleware'i `/panel/*`
 * sayfalarını bu imzalı çerez olmadan sunmaz. Veri koruması değildir (API
 * her istekte JWT ister); giriş yapmamış ziyaretçiye panel arayüzü
 * gösterilmesin diye vardır. Biçim: `v1.<bitiş (sn)>.<HMAC-SHA256 base64url>`,
 * imzalanan metin `v1.<bitiş>`. Doğrulama web'de Web Crypto ile aynıdır
 * (apps/web/src/lib/oturum-isareti.ts).
 *
 * PLT-08: platform paneli (`/platform/*`) ayrı çerez ve ayrı önekle (`p1`)
 * korunur; kiracı işareti platform sayfalarını açmaz, tersi de olmaz. Süresi
 * platform token'ıyla aynıdır (30 dk).
 */
export const OTURUM_ISARETI_COOKIE = "tekir_oturum";
export const OTURUM_ISARETI_SURESI_SN = 30 * 24 * 60 * 60;
export const PLATFORM_OTURUM_ISARETI_COOKIE = "tekir_platform_oturum";
export const PLATFORM_OTURUM_ISARETI_SURESI_SN = 30 * 60;

export type OturumIsaretiTuru = "v1" | "p1";
const SURE: Record<OturumIsaretiTuru, number> = { v1: OTURUM_ISARETI_SURESI_SN, p1: PLATFORM_OTURUM_ISARETI_SURESI_SN };

export function oturumIsaretiSirri(): string | null {
  const sir = process.env.OTURUM_ISARETI_SECRET?.trim();
  return sir && sir.length >= 32 ? sir : null;
}

export function oturumIsaretiUret(sir: string, simdiSn = Math.floor(Date.now() / 1000), tur: OturumIsaretiTuru = "v1"): string {
  const govde = `${tur}.${simdiSn + SURE[tur]}`;
  return `${govde}.${createHmac("sha256", sir).update(govde).digest("base64url")}`;
}

export function oturumIsaretiGecerli(isaret: string | undefined, sir: string, simdiSn = Math.floor(Date.now() / 1000), tur: OturumIsaretiTuru = "v1"): boolean {
  const m = /^((v1|p1)\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(isaret ?? "");
  if (!m || m[2] !== tur || Number(m[3]) <= simdiSn) return false;
  const beklenen = createHmac("sha256", sir).update(m[1]).digest();
  const gelen = Buffer.from(m[4], "base64url");
  return gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen);
}
