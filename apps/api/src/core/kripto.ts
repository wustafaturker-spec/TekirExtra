import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Hassas değerlerin (entegratör kimlik bilgileri, TOTP anahtarları) at-rest
 * şifrelemesi — AES-256-GCM (EBLG-01b). Çıktı biçimi: base64(iv | tag | cipher).
 *
 * Saf fonksiyonlar: NestJS'e bağımlı değildir ki birim testleri hafif kalsın.
 */
const IV_BOYU = 12;
const TAG_BOYU = 16;

function anahtarAl(): Buffer {
  const hex = process.env.BAGLANTI_SIFRELEME_ANAHTARI;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "BAGLANTI_SIFRELEME_ANAHTARI 32 baytlık hex (64 karakter) olmalıdır",
    );
  }
  return Buffer.from(hex, "hex");
}

export function sifrele(duzMetin: string): string {
  const iv = randomBytes(IV_BOYU);
  const cipher = createCipheriv("aes-256-gcm", anahtarAl(), iv);
  const sifreli = Buffer.concat([cipher.update(duzMetin, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sifreli]).toString("base64");
}

export function coz(sifreliMetin: string): string {
  const veri = Buffer.from(sifreliMetin, "base64");
  const iv = veri.subarray(0, IV_BOYU);
  const tag = veri.subarray(IV_BOYU, IV_BOYU + TAG_BOYU);
  const cipher = veri.subarray(IV_BOYU + TAG_BOYU);
  // SEC-11: etiket uzunluğu sabit; kısaltılmış etiketle (daha az bit) doğrulama yapılmaz.
  const decipher = createDecipheriv("aes-256-gcm", anahtarAl(), iv, { authTagLength: TAG_BOYU });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString("utf8");
}

/**
 * SEC-23: saklanmayan, sunucu sırrından türetilen bağlantı anahtarı. Amaç
 * etiketi farklı kullanımları ayırır; veritabanı sızsa da anahtar üretilemez.
 */
export function turetilmisAnahtar(amac: string, ...parcalar: string[]): string {
  return createHmac("sha256", anahtarAl()).update([amac, ...parcalar].join(":")).digest("hex");
}
