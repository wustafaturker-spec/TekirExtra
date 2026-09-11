/**
 * Gerçek kişinin adı ve soyadı (CARI-21). Kartta ayrı tutulur; alanlar boşsa
 * (eski kayıt, tüzel işaretlenmiş TCKN'li cari) unvandan tahmin edilir: son
 * kelime soyad, kalanı ad. `tahmin` bayrağı e-Belge sihirbazında uyarı için.
 */
export function adSoyadCoz(cari: { unvan: string; ad?: string | null; soyad?: string | null }): {
  ad: string;
  soyad: string;
  tahmin: boolean;
} {
  const ad = cari.ad?.trim();
  const soyad = cari.soyad?.trim();
  if (ad && soyad) return { ad, soyad, tahmin: false };
  const parcalar = (cari.unvan ?? "").trim().split(/\s+/).filter(Boolean);
  if (parcalar.length > 1) return { ad: parcalar.slice(0, -1).join(" "), soyad: parcalar[parcalar.length - 1], tahmin: true };
  return { ad: parcalar[0] ?? "", soyad: parcalar[0] ?? "", tahmin: true };
}

/** Gerçek kişide unvan ad ve soyaddan türer; listeler, PDF ve e-posta unvanı kullanır. */
export function gercekKisiUnvani(ad: string, soyad: string): string {
  return `${ad.trim()} ${soyad.trim()}`;
}
