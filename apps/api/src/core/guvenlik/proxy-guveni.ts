/**
 * SEC-06: Express `trust proxy` değeri. İstemci IP'si (rate limit ve kayıtlar)
 * yalnız güvenilen proxy'lerin eklediği X-Forwarded-For'dan okunur.
 *
 * - Sayı: aradaki proxy adedi ("1" tek ters vekil).
 * - "loopback", "uniquelocal" ya da CIDR listesi: yalnız bu adreslerden gelen
 *   başlığa güvenilir (pilot: cloudflared → Next → API zincirinin hepsi yerel).
 * - "true" her başlığa güvenir; X-Forwarded-For'u istemci yazabildiği için
 *   rate limit atlatılır. Üretimde reddedilir.
 */
export function trustProxyDegeri(deger: string | undefined, ortam = process.env.NODE_ENV): number | boolean | string | undefined {
  const d = deger?.trim();
  if (!d) return undefined;
  if (/^\d+$/.test(d)) return Number(d);
  if (d === "false") return false;
  if (d === "true") {
    if (ortam === "production") throw new Error("TRUST_PROXY=true üretimde kullanılamaz: istemci X-Forwarded-For yazarak rate limiti atlatır. Proxy sayısını ya da 'loopback' gibi adres listesini verin.");
    return true;
  }
  return d;
}
