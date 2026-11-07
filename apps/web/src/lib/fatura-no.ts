/**
 * Numarasız faturanın listede ne yazacağı. Giden fatura numarası e-Belge
 * gönderiminde verilir: taslak "Taslak"tır; kesinleşmiş (ya da gönderilmeden
 * iptal edilmiş) numarasız fatura henüz gönderilmemiştir — "Taslak" yazmak
 * yanıltıcıydı. Alış faturasını biz göndermeyiz; numara tedarikçinindir,
 * yoksa yalnız girilmemiştir ("Numarasız").
 */
export function faturaNoMetni(no: string | null | undefined, durum: string | null | undefined, parantezli = false, tip?: string | null): string {
  if (no) return no;
  const metin = !durum || durum === "taslak" ? "Taslak" : tip === "alis" ? "Numarasız" : "Gönderilmedi";
  return parantezli ? `(${metin})` : metin;
}
