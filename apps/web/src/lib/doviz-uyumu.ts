/**
 * FTR-28: fatura, teklif ve sipariş kalemleri belgenin para biriminde tutulur.
 *
 * Kalemin kendi para birimi alanı yoktur; birim fiyat belgenin dövizinde
 * sayılır. Bu yüzden fiyatı başka dövizde olan ürün satıra fiyatıyla yazılmaz
 * (kullanıcı kararı, 2026-09-27: "eklemeyi engelle") — eskiden 10 USD'lik ürün
 * TL faturada 10 TL oluyordu. Belgenin dövizi sonradan değişirse kalemler onayla
 * yeni dövize çevrilir.
 */

/** Ekranda gösterilen para birimi adı; TRY "TL" yazılır. */
export const paraBirimiEtiketi = (doviz: string | null | undefined): string => (!doviz || doviz === "TRY" ? "TL" : doviz);

export const paraBicimi = (deger: string | number, doviz: string | null | undefined = "TRY"): string =>
  `${Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${paraBirimiEtiketi(doviz)}`;

/** Ürünün fiyat dövizi belgeninkinden farklıysa satıra yazılacak uyarı; aynıysa `undefined`. */
export function dovizUyumsuzlugu(kaynakDoviz: string | null | undefined, belgeDovizi: string): string | undefined {
  const kaynak = kaynakDoviz || "TRY";
  if (kaynak === belgeDovizi) return undefined;
  return `Ürünün fiyatı ${paraBirimiEtiketi(kaynak)}, belge ${paraBirimiEtiketi(belgeDovizi)}: fiyat satıra yazılmadı. Belge dövizini ${kaynak} yapın ya da fiyatı ${paraBirimiEtiketi(belgeDovizi)} olarak elle girin.`;
}

/**
 * Kalem fiyatını bir dövizden ötekine çevirir. Kurlar "1 döviz = X TRY"
 * biçimindedir (belgedeki kur alanıyla aynı); TRY'nin kuru 1'dir.
 */
export function fiyatCevir(fiyat: number, eskiKur: number, yeniKur: number): number {
  if (!(eskiKur > 0) || !(yeniKur > 0)) throw new Error("Çeviri için iki kur da sıfırdan büyük olmalıdır");
  return Number(((fiyat * eskiKur) / yeniKur).toFixed(4));
}
