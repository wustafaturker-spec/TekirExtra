/** ILT-04/05/15: gönderim sonucunun sınıfı ve alarm kuralları; veritabanından bağımsızdır. */

export type HataSinifi = "kalici" | "gecici" | "belirsiz";

interface SmtpHatasi { code?: unknown; responseCode?: unknown; command?: unknown }

/**
 * Kalıcı: kimlik reddi, geçersiz alıcı ya da 5xx yanıtı; yeniden denemek işe yaramaz.
 * Belirsiz: içerik sunucuya verildikten sonra bağlantı koptu; iletinin çıkıp çıkmadığı bilinemez,
 * otomatik tekrar ikinci kopya üretebilir.
 */
export function smtpHataSinifi(hata: unknown): HataSinifi {
  const h = (hata ?? {}) as SmtpHatasi;
  const yanit = typeof h.responseCode === "number" ? h.responseCode : null;
  if (h.code === "EAUTH" || h.code === "EENVELOPE") return "kalici";
  if (yanit !== null && yanit >= 500) return "kalici";
  if (yanit === null && h.command === "DATA") return "belirsiz";
  return "gecici";
}

/** Hata metni kayda yazılır; sağlayıcının yanıtındaki adres ve kimlikler kısaltılır. */
export function hataMetni(hata: unknown): string {
  const metin = hata instanceof Error && hata.message ? hata.message : (hata as { code?: string } | null)?.code ?? "Bilinmeyen gönderim hatası";
  return String(metin).slice(0, 500);
}

export interface IletiOzeti { toplam: number; basarisiz: number; bekleyenEnEskiDk: number | null; smtpHatasi: string | null }
export const HATA_ORANI_ESIGI = 0.2;
export const HATA_ORANI_ASGARI_ILETI = 3;
export const KUYRUK_ESIK_DK = 15;

export function iletiSorunlari(o: IletiOzeti): { anahtar: string; tur: string; ozet: string }[] {
  const sorunlar: { anahtar: string; tur: string; ozet: string }[] = [];
  if (o.smtpHatasi) sorunlar.push({ anahtar: "ileti:smtp", tur: "ileti", ozet: `Platform e-posta sunucusuna bağlanılamıyor: ${o.smtpHatasi}` });
  if (o.toplam >= HATA_ORANI_ASGARI_ILETI && o.basarisiz / o.toplam >= HATA_ORANI_ESIGI) sorunlar.push({ anahtar: "ileti:hata-orani", tur: "ileti", ozet: `Son bir saatte ${o.toplam} iletinin ${o.basarisiz} tanesi gönderilemedi` });
  if (o.bekleyenEnEskiDk !== null && o.bekleyenEnEskiDk >= KUYRUK_ESIK_DK) sorunlar.push({ anahtar: "ileti:kuyruk", tur: "ileti", ozet: `E-posta kuyruğunda ${o.bekleyenEnEskiDk} dakikadır bekleyen ileti var` });
  return sorunlar;
}
