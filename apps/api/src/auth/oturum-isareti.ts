import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Rota koruması için oturum işareti: web'in Next middleware'i `/panel/*`
 * sayfalarını bu imzalı çerez olmadan sunmaz. Veri koruması değildir (API
 * her istekte JWT ister); giriş yapmamış ziyaretçiye panel arayüzü
 * gösterilmesin diye vardır. Biçim: `v1.<bitiş (sn)>.<HMAC-SHA256 base64url>`,
 * imzalanan metin `v1.<bitiş>`. Doğrulama web'de Web Crypto ile aynıdır
 * (apps/web/src/lib/oturum-isareti.ts).
 */
export const OTURUM_ISARETI_COOKIE = "tekir_oturum";
export const OTURUM_ISARETI_SURESI_SN = 30 * 24 * 60 * 60;

export function oturumIsaretiSirri(): string | null {
  const sir = process.env.OTURUM_ISARETI_SECRET?.trim();
  return sir && sir.length >= 32 ? sir : null;
}

export function oturumIsaretiUret(sir: string, simdiSn = Math.floor(Date.now() / 1000)): string {
  const govde = `v1.${simdiSn + OTURUM_ISARETI_SURESI_SN}`;
  return `${govde}.${createHmac("sha256", sir).update(govde).digest("base64url")}`;
}

export function oturumIsaretiGecerli(isaret: string | undefined, sir: string, simdiSn = Math.floor(Date.now() / 1000)): boolean {
  const m = /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(isaret ?? "");
  if (!m || Number(m[2]) <= simdiSn) return false;
  const beklenen = createHmac("sha256", sir).update(m[1]).digest();
  const gelen = Buffer.from(m[3], "base64url");
  return gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen);
}
