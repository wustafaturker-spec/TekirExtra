/**
 * KSB-35: POS hesabının taksit komisyon tablosu.
 *
 * Tek çekim oranı POS hesabının `komisyonOrani` alanıdır; tablo yalnız 2–12
 * taksitleri tutar. Tabloda olmayan taksit ödeme sayfasında açılmaz.
 */

export const POS_TAKSIT_SECENEKLERI = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export interface PosTaksitOrani {
  taksit: number;
  /** Yüzde, "3.49" biçiminde. */
  oran: string;
}

/** Ödeme sayfasında açılacak taksitler: her zaman tek çekim + tablodakiler (artan). */
export function posAcikTaksitler(tablo: readonly PosTaksitOrani[]): number[] {
  return [1, ...[...new Set(tablo.map((t) => t.taksit))].filter((t) => t >= 2 && t <= 12).sort((a, b) => a - b)];
}

/** PayTR yalnız üst sınır alır: tanımlı en büyük taksit (tablo boşsa 1). */
export function posAzamiTaksit(tablo: readonly PosTaksitOrani[]): number {
  const acik = posAcikTaksitler(tablo);
  return acik[acik.length - 1];
}

/**
 * PayTR'de üst sınırın altındaki her taksit açılır; tabloda tanımlanmamış ara
 * taksitler komisyonu bilinmeden açılmış olur. Bu taksitler uyarı için döner.
 */
export function posTaksitBosluklari(tablo: readonly PosTaksitOrani[]): number[] {
  const acik = new Set(posAcikTaksitler(tablo));
  const azami = posAzamiTaksit(tablo);
  const bos: number[] = [];
  for (let t = 2; t < azami; t++) if (!acik.has(t)) bos.push(t);
  return bos;
}

/** Taksitin oranı; tek çekim ya da tabloda olmayan taksitte tek çekim oranı döner. */
export function posTaksitOrani(hesap: { komisyonOrani: string | number; taksitOranlari: readonly PosTaksitOrani[] }, taksit: number): string {
  if (taksit > 1) {
    const satir = hesap.taksitOranlari.find((t) => t.taksit === taksit);
    if (satir) return satir.oran;
  }
  return String(hesap.komisyonOrani);
}
