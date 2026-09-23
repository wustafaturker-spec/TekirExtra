/**
 * e-Belgesi entegratöre hiç ulaşmamış fatura (EBLG-81): gönderim "hata" ile
 * bitmiş, sağlayıcı numara atamamış ve entegratör referansı yazılmamış. Böyle
 * bir faturanın GİB'de karşılığı yoktur; kanal e-Fatura bile olsa iade
 * faturası gerekmez, fatura iptal edilebilir. Sunucu iptal anında entegratöre
 * sorarak doğrular (önceki denemede belge oluşup kayda yazılamamış olabilir).
 */
export function ebelgeGitmemisMi(girdi: {
  faturaNo: string | null | undefined;
  ebelge: { durum: string; entegratorRef?: string | null } | null | undefined;
}): boolean {
  const { ebelge } = girdi;
  if (!ebelge) return false;
  return ebelge.durum === "hata" && !girdi.faturaNo && !ebelge.entegratorRef;
}
