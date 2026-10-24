import { createHash, randomInt } from "node:crypto";

/** Yönetim P1-1: 2FA etkinleşince verilen tek kullanımlık kod sayısı. */
export const KURTARMA_KODU_SAYISI = 10;

// Karıştırılan karakterler (0/O, 1/I/L) yok: 31 karakter, 10 hane ≈ 49 bit.
const ALFABE = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Kullanıcının göreceği biçim: XXXXX-XXXXX. */
export function kurtarmaKoduUret(): string {
  const hane = Array.from({ length: 10 }, () => ALFABE[randomInt(ALFABE.length)]).join("");
  return `${hane.slice(0, 5)}-${hane.slice(5)}`;
}

/** Boşluk, tire ve küçük harf farkı yok sayılır. */
export function kurtarmaKoduNormalle(kod: string): string {
  return kod.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Kurtarma kodu biçimine (10 hane) uyuyor mu; 6 haneli TOTP kodundan ayırmak için. */
export function kurtarmaKoduBicimindeMi(kod: string): boolean {
  return kurtarmaKoduNormalle(kod).length === 10;
}

export function kurtarmaKoduOzeti(kod: string): string {
  return createHash("sha256").update(kurtarmaKoduNormalle(kod)).digest("hex");
}

export function kurtarmaKodlariUret(): { kodlar: string[]; ozetler: string[] } {
  const kodlar = Array.from({ length: KURTARMA_KODU_SAYISI }, kurtarmaKoduUret);
  return { kodlar, ozetler: kodlar.map(kurtarmaKoduOzeti) };
}
