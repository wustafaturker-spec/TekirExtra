/**
 * EBLG-95: müşterinin ya da teslim edilecek miktarın sevkiyat başlarken
 * bilinmediği sevklerde (araçla dağıtım, seyyar satış) e-İrsaliye alıcısı
 * GİB'in "Muhtelif Müşteriler" kimliğidir (GİB e-İrsaliye SSS 25). Teslimat
 * oldukça her müşteriye ayrıca fatura ya da o müşteri adına irsaliye kesilir.
 *
 * Kiracıda bu kimlikle tek bir sistem carisi tutulur; muhtelif irsaliye, carisi
 * bu kimliği taşıyan satış irsaliyesidir.
 */
export const MUHTELIF_MUSTERI_VKN = "5555555555";
export const MUHTELIF_MUSTERI_UNVAN = "Muhtelif Müşteriler";
export const MUHTELIF_MUSTERI_KOD = "MUHTELIF";

export function muhtelifMusteriMi(cari: { vknTckn?: string | null } | null | undefined): boolean {
  return cari?.vknTckn?.trim() === MUHTELIF_MUSTERI_VKN;
}
