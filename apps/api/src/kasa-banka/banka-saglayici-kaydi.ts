import type { BankaSaglayicisi } from "./banka-saglayici";
import { VomsisSaglayicisi } from "./vomsis.adapter";

/**
 * KSB-30: API ile hareket çeken banka sağlayıcıları (`baglantilar.saglayici`).
 * Yeni toplayıcı ya da banka API'si buraya eklenir; senkron, otomatik çekim,
 * hata sayacı ve bildirimler kendiliğinden çalışır. `webhook` bu listede
 * değildir: hareketi sağlayıcı iter, sistem çekmez.
 */
export const BANKA_SAGLAYICILARI: Record<string, BankaSaglayicisi> = {
  vomsis: new VomsisSaglayicisi(),
};

export const CEKILEN_SAGLAYICILAR = () => Object.keys(BANKA_SAGLAYICILARI);

export function saglayiciBul(kod: string): BankaSaglayicisi | undefined {
  return BANKA_SAGLAYICILARI[kod];
}
