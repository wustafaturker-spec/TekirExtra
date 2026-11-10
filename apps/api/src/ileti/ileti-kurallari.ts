import { HttpException, HttpStatus } from "@nestjs/common";

/** ILT-04/05/14/15: gönderim sonucunun sınıfı, sınırlar ve alarm kuralları; veritabanından bağımsızdır. */

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

export type IletiKanali = "eposta" | "sms";
export interface IletiTavani { gunluk: number; aylik: number }
export interface IletiTavanlari { epostaGunluk: number; epostaAylik: number; smsGunluk: number; smsAylik: number }
/** ILT-14 varsayılanları; platform panelinden değiştirilir, firma başına istisna tanımlanır. */
export const VARSAYILAN_TAVANLAR: IletiTavanlari = { epostaGunluk: 1_000, epostaAylik: 20_000, smsGunluk: 500, smsAylik: 5_000 };
/** Otomatik iletide aynı alıcıya aynı türde bir saatte çıkabilecek ileti sayısı. */
export const TEKRAR_SINIRI_ADET = 5;
export const TEKRAR_PENCERESI_MS = 3_600_000;
/** Tavan reddi kayda bu sonla yazılır; firma uyarısı bu kayıtlardan üretilir. */
export const TAVAN_HATA_SONU = "tavanı doldu";

export type SinirNedeni = "gunluk" | "aylik" | "tekrar";
/** Gönderim hiç başlamadı; iletinin çıkmadığı kesindir, çağıran sonra yeniden deneyebilir. */
export class IletiSiniriAsildi extends HttpException {
  constructor(mesaj: string, readonly neden: SinirNedeni) { super(mesaj, HttpStatus.TOO_MANY_REQUESTS); }
}

const KANAL_ADI: Record<IletiKanali, string> = { eposta: "e-posta", sms: "SMS" };
export function tavanIhlali(kanal: IletiKanali, sayilar: IletiTavani, tavan: IletiTavani): { neden: "gunluk" | "aylik"; kayit: string; mesaj: string } | null {
  const neden = sayilar.gunluk >= tavan.gunluk ? "gunluk" : sayilar.aylik >= tavan.aylik ? "aylik" : null;
  if (!neden) return null;
  const ad = neden === "gunluk" ? "Günlük" : "Aylık";
  return { neden, kayit: `${ad} ${KANAL_ADI[kanal]} ${TAVAN_HATA_SONU}`, mesaj: `${ad} ${KANAL_ADI[kanal]} tavanına (${tavan[neden]}) ulaşıldı` };
}
export const tekrarIhlali = () => new IletiSiniriAsildi(`Aynı alıcıya bir saatte en çok ${TEKRAR_SINIRI_ADET} otomatik ileti gönderilir`, "tekrar");

const istanbulTarih = (s: Date) => s.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
export const istanbulGunBasi = (s = new Date()) => new Date(`${istanbulTarih(s)}T00:00:00+03:00`);
export const istanbulAyBasi = (s = new Date()) => new Date(`${istanbulTarih(s).slice(0, 7)}-01T00:00:00+03:00`);
