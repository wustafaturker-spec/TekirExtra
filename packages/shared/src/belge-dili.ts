/**
 * FTR-40 / STK-41: ticari belgelerin basım dili. Belge tek dilde ya da çift
 * dilde (Türkçe + seçilen dil) basılır; dil belgede saklanır, varsayılanı
 * cari kartından gelir. Ürün adlarının çevirisi stok kartında tutulur.
 */

export const BELGE_DILLERI = ["tr", "en", "de", "ar", "ru"] as const;
export type BelgeDili = (typeof BELGE_DILLERI)[number];

export const BELGE_DILI_ADLARI: Record<BelgeDili, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  ar: "Arapça",
  ru: "Rusça",
};

/** Yabancı diller: stok kartında ad girilebilenler ve çift dilin ikinci dili. */
export const YABANCI_BELGE_DILLERI = BELGE_DILLERI.filter((d) => d !== "tr") as Exclude<BelgeDili, "tr">[];

export function belgeDiliNormalize(deger: unknown): BelgeDili {
  return BELGE_DILLERI.includes(deger as BelgeDili) ? (deger as BelgeDili) : "tr";
}

/**
 * Çift dil yalnız yabancı bir dille anlamlıdır: Türkçe belgede bayrak
 * düşer. Sunucu da ekran da bu kuralla okur.
 */
export function ciftDilGecerli(dil: BelgeDili, ciftDil: boolean | null | undefined): boolean {
  return dil !== "tr" && ciftDil === true;
}

/** STK-41: dil başına ürün adı ve isteğe bağlı açıklama. */
export type YabanciAdlar = Partial<Record<Exclude<BelgeDili, "tr">, { ad: string; aciklama?: string | null }>>;

export const YABANCI_AD_UZUNLUGU = 200;
export const YABANCI_ACIKLAMA_UZUNLUGU = 500;

/** Boş adları atar, bilinmeyen dilleri yok sayar; hiç ad kalmazsa null. */
export function yabanciAdlarNormalize(deger: unknown): YabanciAdlar | null {
  if (!deger || typeof deger !== "object") return null;
  const sonuc: YabanciAdlar = {};
  for (const dil of YABANCI_BELGE_DILLERI) {
    const kayit = (deger as Record<string, unknown>)[dil];
    if (!kayit || typeof kayit !== "object") continue;
    const ad = String((kayit as { ad?: unknown }).ad ?? "").trim().slice(0, YABANCI_AD_UZUNLUGU);
    if (!ad) continue;
    const aciklama = String((kayit as { aciklama?: unknown }).aciklama ?? "").trim().slice(0, YABANCI_ACIKLAMA_UZUNLUGU);
    sonuc[dil] = aciklama ? { ad, aciklama } : { ad };
  }
  return Object.keys(sonuc).length ? sonuc : null;
}
