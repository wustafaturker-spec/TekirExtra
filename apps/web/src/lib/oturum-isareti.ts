/**
 * Rota koruması: API'nin giriş/yenilemede koyduğu `tekir_oturum` çerezinin
 * Web Crypto ile doğrulanması (middleware edge çalışma ortamında). Biçim ve
 * imza API ile aynıdır (apps/api/src/auth/oturum-isareti.ts):
 * `v1.<bitiş (sn)>.<HMAC-SHA256(v1.<bitiş>) base64url>`. Platform paneli
 * (PLT-08) ayrı çerezde `p1` önekiyle; bir tür diğerinin sayfalarını açmaz.
 */
export const OTURUM_ISARETI_COOKIE = "tekir_oturum";
export const PLATFORM_OTURUM_ISARETI_COOKIE = "tekir_platform_oturum";
export type OturumIsaretiTuru = "v1" | "p1";

const base64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function oturumIsaretiGecerli(isaret: string | undefined, sir: string, simdiSn = Math.floor(Date.now() / 1000), tur: OturumIsaretiTuru = "v1"): Promise<boolean> {
  const m = /^((v1|p1)\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(isaret ?? "");
  if (!m || m[2] !== tur || Number(m[3]) <= simdiSn) return false;
  const anahtar = await crypto.subtle.importKey("raw", new TextEncoder().encode(sir), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const beklenen = base64url(await crypto.subtle.sign("HMAC", anahtar, new TextEncoder().encode(m[1])));
  // Sabit süreli karşılaştırma (uzunluklar eşit: 43).
  let fark = 0;
  for (let i = 0; i < beklenen.length; i++) fark |= beklenen.charCodeAt(i) ^ m[4].charCodeAt(i);
  return fark === 0;
}

/** Girişten sonra dönülecek yol: yalnız panel içi göreli yollar (açık yönlendirme olmasın). */
export function guvenliDonus(donus: string | null | undefined): string {
  if (!donus || !donus.startsWith("/panel") || donus.startsWith("//") || /[\\\r\n]/.test(donus)) return "/panel";
  return donus;
}
