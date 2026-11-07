/**
 * Numarasız faturanın listede ne yazacağı. Fatura numarası e-Belge gönderiminde
 * verilir: taslak "Taslak"tır; kesinleşmiş (ya da gönderilmeden iptal edilmiş)
 * numarasız fatura henüz gönderilmemiştir — "Taslak" yazmak yanıltıcıydı.
 */
export function faturaNoMetni(no: string | null | undefined, durum: string | null | undefined, parantezli = false): string {
  if (no) return no;
  const metin = !durum || durum === "taslak" ? "Taslak" : "Gönderilmedi";
  return parantezli ? `(${metin})` : metin;
}
