/**
 * DVZ-09 (karar 2026-10-03): belge ve fişlerde önerilen TCMB kurunun türü
 * işlemin **yönüne** göre seçilir. Döviz girişi ya da alacak doğuran işlem
 * döviz alış, döviz çıkışı ya da borç doğuran işlem döviz satış kuruyla
 * değerlenir. Böylece fatura ile ödemesi aynı kur türünü kullanır ve
 * yalnızca tür farkından kur farkı doğmaz. Kullanıcı kuru her zaman elle
 * değiştirebilir; kaydedilmiş belge kendi kurunu taşır (DVZ-08).
 */
export type KurTipi = "alis" | "satis";

/** Satış faturası ve alış iadesi alacak doğurur → alış; alış faturası ve satış iadesi borç → satış. */
export function faturaKurTipi(faturaTipi: string): KurTipi {
  return faturaTipi === "alis" || faturaTipi === "satis_iade" ? "satis" : "alis";
}

/** Kasa/banka/POS hareketi: hesaba giriş (tahsilat, virman girişi) alış; çıkış satış. */
export function hareketKurTipi(hareketTipi: string): KurTipi {
  return hareketTipi === "tahsilat" || hareketTipi === "virman_gelis" ? "alis" : "satis";
}

/** Elle cari hareketi faturayla aynı kuralı izler: borç (satış faturası gibi) alış, alacak satış. */
export function cariHareketKurTipi(tip: "borc" | "alacak"): KurTipi {
  return tip === "borc" ? "alis" : "satis";
}

/** Giriş yönlü işlem (gelir, virman, açılış, POS aktarımı, değerleme) alış; çıkış yönlü (masraf, kira, kart harcaması, kesinti) satış. */
export const GIRIS_KUR_TIPI: KurTipi = "alis";
export const CIKIS_KUR_TIPI: KurTipi = "satis";
