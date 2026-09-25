/**
 * Firmanın (satıcının) e-belgede görünen bilgileri (EBLG-62). Adres,
 * iletişim, MERSİS ve ticaret sicil numarası firma kartında tutulur; e-Fatura,
 * e-Arşiv ve e-İrsaliye'nin satıcı tarafına ve kendi PDF'lerimize yazılır.
 *
 * Karar (2026-09-19): adres eksikse gönderim durur. Satıcı adresi belgede
 * zorunludur; önceden yerine sabit "Merkez/Istanbul" ve "Marmara V.D."
 * yazılıyordu.
 */
export interface FirmaEbelgeBilgisi {
  vergiDairesi?: string | null;
  adres?: string | null;
  ilce?: string | null;
  il?: string | null;
  postaKodu?: string | null;
  telefon?: string | null;
  eposta?: string | null;
  webSitesi?: string | null;
  mersisNo?: string | null;
  ticaretSicilNo?: string | null;
}

/** MERSİS numarası 16 hanedir (VKN'nin başına 0 eklenmiş hâli + sıra). */
export const mersisNoGecerliMi = (no: string | null | undefined): boolean => !no || /^\d{16}$/.test(no.trim());

/** Belgenin gönderilmesini engelleyen firma eksikleri; boşsa gönderilebilir. */
export function firmaEbelgeEksikleri(firma: FirmaEbelgeBilgisi): string[] {
  const bos = (deger: string | null | undefined) => !deger?.trim();
  const eksik: string[] = [];
  if (bos(firma.adres)) eksik.push("adres");
  if (bos(firma.ilce)) eksik.push("ilçe");
  if (bos(firma.il)) eksik.push("il");
  if (bos(firma.vergiDairesi)) eksik.push("vergi dairesi");
  // Kullanıcı carinin (alıcının) adresini girip bu uyarıyı almaya devam etti
  // (2026-09-25); eksik olanın satıcının kendi adresi olduğu açıkça söylenir.
  return eksik.length ? [`Firmanızın (satıcının) bilgilerinde ${eksik.join(", ")} eksik; bu, carinin adresi değil, belgeyi kesen firmanın bilgisidir. Ayarlar › Firma ekranından tamamlayın.`] : [];
}
