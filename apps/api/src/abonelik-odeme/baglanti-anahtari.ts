import { createHmac, timingSafeEqual } from "node:crypto";

/** PLT-13: hatırlatma e-postasındaki ödeme bağlantısı bu kadar gün geçerlidir. */
export const BAGLANTI_GECERLILIK_GUN = 45;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imza(govde: string): string {
  const sir = process.env.JWT_SECRET;
  if (!sir) throw new Error("JWT_SECRET tanımlı değil");
  // Oturum token'larıyla karışmasın diye ayrı bir alt anahtar.
  const anahtar = createHmac("sha256", sir).update("abonelik-odeme-baglantisi").digest();
  return createHmac("sha256", anahtar).update(govde).digest("base64url");
}

/**
 * Oturumsuz ödeme bağlantısının anahtarı: firma kimliği + son geçerlilik + imza.
 * Bağlantı yalnız ödeme sayfasını açar (firma verisi göstermez), bu yüzden
 * durumsuz imza yeterlidir; veritabanında saklanmaz.
 */
export function baglantiAnahtariUret(tenantId: string, simdi = new Date()): string {
  const son = Math.floor(simdi.getTime() / 1000) + BAGLANTI_GECERLILIK_GUN * 86_400;
  const govde = `${tenantId}.${son.toString(36)}`;
  return `${govde}.${imza(govde)}`;
}

/** Geçerliyse firma kimliğini, değilse null döner. */
export function baglantiAnahtariDogrula(anahtar: string, simdi = new Date()): string | null {
  const parca = anahtar.split(".");
  if (parca.length !== 3 || !UUID.test(parca[0])) return null;
  const son = parseInt(parca[1], 36);
  if (!Number.isFinite(son) || son * 1000 < simdi.getTime()) return null;
  const beklenen = Buffer.from(imza(`${parca[0]}.${parca[1]}`));
  const gelen = Buffer.from(parca[2]);
  return beklenen.length === gelen.length && timingSafeEqual(beklenen, gelen) ? parca[0].toLowerCase() : null;
}
