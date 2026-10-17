/** CARI-49: tahmini gecikmenin isabeti — rapor, Cari Durum Paneli ve Yapay Zeka ayarı ortak biçimi. */
export interface IsabetOlcusu { ornek: number; ortalamaSapma: number | null; ortalamaMutlakSapma: number | null }

const gun = (n: number) => `${Math.abs(n).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`;

/** Sapma = gerçekleşen − tahmin: pozitif tahminden geç, negatif erken ödendi demektir. */
export function sapmaMetni(sapma: number | null): string {
  if (sapma === null) return "—";
  if (Math.abs(sapma) < 0.05) return "tahminle aynı";
  return `${gun(sapma)} ${sapma > 0 ? "geç" : "erken"}`;
}

export const mutlakSapmaMetni = (mae: number | null) => (mae === null ? "—" : `± ${gun(mae)}`);
