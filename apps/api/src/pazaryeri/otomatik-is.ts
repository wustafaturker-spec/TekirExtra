import { PAZARYERI_SAGLAYICILARI } from "@tekirextra/shared";
/**
 * PZR-18: pazaryeri otomatik çekim kuralları (saf). Kararlar 2026-11-07:
 * varsayılan sipariş 60 dk, finans günde bir; stok/fiyat (PZR-19) zamanlanmaz.
 */
export const OTOMATIK_ISLER = ["siparis", "finans"] as const;
export type OtomatikIs = (typeof OTOMATIK_ISLER)[number];
export const ARALIK_SECENEKLERI = [0, 15, 30, 60, 360, 1440] as const;
export const EN_UZUN_ARALIK_DK = 1440;
/** Bu sayıda üst üste başarısız denemede Bildirim Merkezi uyarısı. */
export const HATA_ESIGI = 3;
/** Finans hareketi çekilebilen sağlayıcılar. */
export const FINANS_SAGLAYICILARI = ["amazon_tr", "trendyol", "hepsiburada"];

export function isUygun(saglayici: string, is: OtomatikIs): boolean {
  // ETC-04: e-ticaret siteleri de siparişte pazaryeriyle aynı otomatik çekimi kullanır.
  return is === "siparis" ? (PAZARYERI_SAGLAYICILARI as readonly string[]).includes(saglayici) : FINANS_SAGLAYICILARI.includes(saglayici);
}

export function varsayilanAralik(is: OtomatikIs): number {
  return is === "siparis" ? 60 : 1440;
}

export const IS_ADI: Record<OtomatikIs, string> = { siparis: "Sipariş çekimi", finans: "Finans hareketleri" };

/** Hata türü: kimlik reddi işi durdurur, geçici hata aralığı uzatır, diğerleri yalnız sayılır. */
export function hataTuru(mesaj: string): "kimlik" | "gecici" | "diger" {
  if (/HTTP 40[13]\b|kimlik doğrulama|unauthori[sz]ed|forbidden/i.test(mesaj)) return "kimlik";
  if (/HTTP 429\b|HTTP 5\d\d\b|timeout|zaman aşımı|fetch failed|ECONN|ETIMEDOUT|aborted|socket hang up/i.test(mesaj)) return "gecici";
  return "diger";
}

export interface IsDurumu {
  aralikDk: number; sonDeneme: Date | null; sonBasari: Date | null; ardisikHata: number;
  sonHata: string | null; durduNedeni: string | null; beklemeCarpani: number;
}

/** Sonraki otomatik çalışma; kapalı ya da durmuşsa null. */
export function sonrakiCalisma(d: Pick<IsDurumu, "aralikDk" | "sonDeneme" | "durduNedeni" | "beklemeCarpani">, simdi = new Date()): Date | null {
  if (d.aralikDk <= 0 || d.durduNedeni) return null;
  if (!d.sonDeneme) return simdi;
  const dk = Math.min(d.aralikDk * Math.max(1, d.beklemeCarpani), Math.max(d.aralikDk, EN_UZUN_ARALIK_DK));
  return new Date(d.sonDeneme.getTime() + dk * 60_000);
}

/** Denemenin sonucuna göre yeni durum (elle ya da otomatik). Başarı durdurmayı ve sayaçları sıfırlar. */
export function denemeSonucu(d: Pick<IsDurumu, "aralikDk" | "ardisikHata" | "beklemeCarpani">, hata: string | null, simdi = new Date()) {
  if (!hata) return { sonDeneme: simdi, sonBasari: simdi, ardisikHata: 0, sonHata: null, durduNedeni: null, beklemeCarpani: 1 };
  const tur = hataTuru(hata);
  const enCok = Math.max(1, Math.floor(EN_UZUN_ARALIK_DK / Math.max(1, d.aralikDk)));
  return {
    sonDeneme: simdi,
    ardisikHata: d.ardisikHata + 1,
    sonHata: hata.slice(0, 500),
    ...(tur === "kimlik" ? { durduNedeni: `Pazaryeri kimlik bilgisini reddetti: ${hata}`.slice(0, 500) } : {}),
    beklemeCarpani: tur === "gecici" ? Math.min(Math.max(1, d.beklemeCarpani) * 2, enCok) : 1,
  };
}
