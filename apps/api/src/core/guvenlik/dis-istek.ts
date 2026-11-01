import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

/**
 * SEC-03: kiracının girdiği adreslere (entegratör, POS, banka, pazaryeri, SMS
 * servis adresleri; SMTP/IMAP sunucusu; yapay zekâ adresi) giden bağlantılar.
 * Firma kaydı herkese açık olduğu için bu adresler internetten gelen girdidir;
 * sunucunun iç ağına (veritabanı, Redis, bulut metadata servisi) yönelemezler.
 *
 * Denetim iki yerde yapılır: kayıtta biçim (https, kimlik bilgisi yok, IP/yerel
 * ad yok, bilinen sağlayıcıda alan adı) ve bağlantı anında çözümlenen IP (DNS
 * rebinding: kayıtta genel adrese çözülen ad bağlantıda iç ağa dönebilir).
 */

/** Genel internette yönlendirilemeyen ya da sunucunun kendisini gösteren adres mi. */
export function ozelIpMi(adres: string): boolean {
  const ip = adres.toLowerCase().split("%")[0].replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:")) {
    const ic = ip.slice(7);
    if (isIP(ic) === 4) return ozelIpMi(ic);
    // ::ffff:7f00:1 biçimi
    const p = ic.split(":");
    if (p.length === 2) {
      const a = parseInt(p[0], 16), b = parseInt(p[1], 16);
      return ozelIpMi(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    return true;
  }
  const tur = isIP(ip);
  if (tur === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (tur === 6) {
    return (
      ip === "::" || ip === "::1" ||
      /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff") ||
      ip.startsWith("2001:db8:") || ip.startsWith("64:ff9b:") || ip.startsWith("100::") || ip.startsWith("2002:")
    );
  }
  return true;
}

const YEREL_AD = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|arpa|nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/i;

/**
 * Yalnız geliştirmede, yerel taklit sunucularla denemek için iç ağ izni
 * (`DIS_ISTEK_YEREL_IZNI=true`). Üretimde değişken ne olursa olsun kapalıdır.
 */
export function yerelIzinli(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DIS_ISTEK_YEREL_IZNI === "true";
}

/** Ana makine adı biçim olarak dışarıya mı (IP değil, yerel/dinamik DNS adı değil). */
export function anaMakineHatasi(anaMakine: string): string | null {
  const ad = anaMakine.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!ad) return "Sunucu adı boş olamaz.";
  if (yerelIzinli()) return null;
  if (isIP(ad)) return "Sunucu IP değil alan adı olmalı.";
  if (!ad.includes(".") || YEREL_AD.test(ad)) return "Yerel ağ ya da dinamik DNS adresleri kullanılamaz.";
  if (!/^[a-z0-9.-]+$/.test(ad)) return "Sunucu adı geçersiz karakter içeriyor.";
  return null;
}

/**
 * Kiracının girdiği servis adresi için kayıt anı denetimi. `alanlar` verilirse
 * ana makine bu alan adlarından biri ya da alt alanı olmalıdır (bilinen sağlayıcı).
 */
export function disAdresHatasi(adres: string, alanlar?: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(adres.trim());
  } catch {
    return "Adres geçerli bir URL değil.";
  }
  if (url.protocol !== "https:" && !(yerelIzinli() && url.protocol === "http:")) return "Adres https ile başlamalı.";
  if (url.username || url.password) return "Adreste kullanıcı adı/parola olamaz.";
  if (url.port && url.port !== "443" && !yerelIzinli()) return "Adres standart https portunu (443) kullanmalı.";
  const hata = anaMakineHatasi(url.hostname);
  if (hata) return hata;
  if (alanlar?.length && !yerelIzinli()) {
    const ad = url.hostname.toLowerCase();
    if (!alanlar.some((a) => ad === a || ad.endsWith(`.${a}`))) return `Adres sağlayıcının alan adında olmalı (${alanlar.join(", ")}).`;
  }
  return null;
}

export class OzelAdresHatasi extends Error {
  readonly code = "OZEL_ADRES";
  constructor(anaMakine: string) {
    super(`${anaMakine} özel veya yerel bir ağ adresine çözümleniyor; bağlantı engellendi.`);
    this.name = "OzelAdresHatasi";
  }
}

/** Ad çözümlemesi; çıkan adreslerden biri bile özelse bağlantı kurulmaz. */
export function guvenliLookup(
  anaMakine: string,
  secenek: { all?: boolean; family?: number } | number | undefined,
  geri: (hata: NodeJS.ErrnoException | null, adres: string | LookupAddress[], aile?: number) => void,
): void {
  dnsLookup(anaMakine, { all: true, verbatim: true }, (hata, adresler) => {
    if (hata) return geri(hata, []);
    if (!yerelIzinli() && (!adresler.length || adresler.some((a) => ozelIpMi(a.address)))) return geri(new OzelAdresHatasi(anaMakine) as NodeJS.ErrnoException, []);
    const tumu = typeof secenek === "object" && secenek?.all;
    if (tumu) return geri(null, adresler);
    geri(null, adresler[0].address, adresler[0].family);
  });
}

/** Kiracı adreslerine giden fetch istekleri için bağlantı anında IP denetleyen dağıtıcı. */
export const disAgent = new Agent({ connect: { lookup: guvenliLookup as never } });

/**
 * Kiracının belirlediği adrese istek. Yönlendirme izlenmez (genel adres iç
 * ağa yönlendirebilir); bağlantı IP'si {@link guvenliLookup} ile denetlenir.
 */
export function disFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { redirect: "manual", ...init, dispatcher: disAgent } as RequestInit);
}

/**
 * SMTP/IMAP gibi fetch dışı bağlantılar için: adı çözer, özel adresi reddeder
 * ve bağlanılacak IP'yi döndürür (TLS doğrulaması için asıl ad `servername`
 * olarak kullanılmalı). IP sabitlendiği için arada DNS değişse de iç ağa gidilmez.
 */
export async function guvenliAdresCoz(anaMakine: string): Promise<{ ip: string; servername: string }> {
  const ad = anaMakine.trim();
  const hata = anaMakineHatasi(ad);
  if (hata) throw new OzelAdresHatasi(`${ad} (${hata})`);
  if (yerelIzinli()) return { ip: ad, servername: ad };
  const adresler = await dnsLookupAsync(ad, { all: true, verbatim: true });
  if (!adresler.length || adresler.some((a) => ozelIpMi(a.address))) throw new OzelAdresHatasi(ad);
  return { ip: adresler[0].address, servername: ad };
}
