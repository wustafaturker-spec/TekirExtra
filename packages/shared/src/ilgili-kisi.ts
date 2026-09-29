/**
 * FTR-32: müşteri tarafında ilgili kişi. Carinin kişilerinden seçilir ya da
 * elle yazılır; ad-soyad ve görev belgeye kopyalanır. Görev tek başına
 * anlamsızdır: ad yoksa görev de yazılmaz.
 */

export interface IlgiliKisi {
  ilgiliKisi?: string | null;
  ilgiliKisiGorevi?: string | null;
}

/** Sunucuya yazılacak değerler: boşluklar kırpılır, adsız görev düşer. */
export function ilgiliKisiTemizle(k: IlgiliKisi): { ilgiliKisi: string | null; ilgiliKisiGorevi: string | null } {
  const ad = k.ilgiliKisi?.trim() || null;
  return { ilgiliKisi: ad, ilgiliKisiGorevi: ad ? k.ilgiliKisiGorevi?.trim() || null : null };
}

/** Çıktı ve ekran metni: "Ad Soyad (Görev)"; kişi yoksa null. */
export function ilgiliKisiMetni(k: IlgiliKisi): string | null {
  const { ilgiliKisi, ilgiliKisiGorevi } = ilgiliKisiTemizle(k);
  if (!ilgiliKisi) return null;
  return ilgiliKisiGorevi ? `${ilgiliKisi} (${ilgiliKisiGorevi})` : ilgiliKisi;
}

/** Birleşen belgelerde (toplu faturalama) ilk dolu kişi, göreviyle birlikte. */
export function ilkIlgiliKisi(belgeler: IlgiliKisi[]): { ilgiliKisi: string | null; ilgiliKisiGorevi: string | null } {
  const kaynak = belgeler.find((b) => b.ilgiliKisi?.trim());
  return ilgiliKisiTemizle(kaynak ?? {});
}
