import { bugunTR, gunTR } from "@tekirextra/shared";

/**
 * e-Arşiv iptal süresinin başlangıcı (karar 2026-10-09): süre faturanın
 * alıcıya ulaştığı günden işler (TTK 21/2'deki 8 günlük itiraz süresi, sektör
 * uygulaması). e-Arşivde iletim gönderim günüdür; fatura geriye tarihli
 * kesilip sonradan gönderildiyse hak kısalmasın diye fatura tarihi ile
 * gönderim gününden hangisi sonraysa o alınır. Takvim günüyle sayılır.
 */
export function earsivIptalBaslangici(faturaTarihi: Date, gonderim?: Date | null): string {
  const fatura = gunTR(faturaTarihi);
  const gonderimGunu = gonderim ? gunTR(gonderim) : null;
  return gonderimGunu && gonderimGunu > fatura ? gonderimGunu : fatura;
}

/** Başlangıçtan bugüne geçen takvim günü. */
export function earsivIptalGecenGun(faturaTarihi: Date, gonderim?: Date | null, bugun = bugunTR()): number {
  const baslangic = earsivIptalBaslangici(faturaTarihi, gonderim);
  return Math.round((Date.parse(`${bugun}T00:00:00Z`) - Date.parse(`${baslangic}T00:00:00Z`)) / 86_400_000);
}
