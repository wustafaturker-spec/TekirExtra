/**
 * DVZ-10 (karar 2026-10-03): desteklenen para birimleri — TL ve TCMB'nin
 * gösterge kuru yayımladığı bütün dövizler (SDR hariç; satış kuru yoktur).
 * Liste tek yerde tutulur: doğrulama şemaları, seçim kutuları, TCMB çekimi
 * ve Prisma `DovizCinsi` enum'u bununla aynı olmalıdır (API'de test eder).
 * Sık kullanılanlar başta; seçim kutuları kalanları "Diğer dövizler" altında gösterir.
 */
export const DOVIZ_CINSLERI = [
  "TRY", "USD", "EUR", "GBP", "CHF",
  "AED", "AUD", "AZN", "CAD", "CNY", "DKK", "JPY", "KRW", "KWD", "KZT", "NOK", "PKR", "QAR", "RON", "RUB", "SAR", "SEK",
] as const;

export type DovizKodu = (typeof DOVIZ_CINSLERI)[number];
export type YabanciDoviz = Exclude<DovizKodu, "TRY">;

export const YABANCI_DOVIZLER = DOVIZ_CINSLERI.filter((d): d is YabanciDoviz => d !== "TRY");
export const SIK_DOVIZLER: readonly DovizKodu[] = ["TRY", "USD", "EUR", "GBP", "CHF"];

export const DOVIZ_ADLARI: Record<DovizKodu, string> = {
  TRY: "Türk Lirası",
  USD: "ABD Doları",
  EUR: "Euro",
  GBP: "İngiliz Sterlini",
  CHF: "İsviçre Frangı",
  AED: "BAE Dirhemi",
  AUD: "Avustralya Doları",
  AZN: "Azerbaycan Manatı",
  CAD: "Kanada Doları",
  CNY: "Çin Yuanı",
  DKK: "Danimarka Kronu",
  JPY: "Japon Yeni",
  KRW: "Güney Kore Wonu",
  KWD: "Kuveyt Dinarı",
  KZT: "Kazakistan Tengesi",
  NOK: "Norveç Kronu",
  PKR: "Pakistan Rupisi",
  QAR: "Katar Riyali",
  RON: "Rumen Leyi",
  RUB: "Rus Rublesi",
  SAR: "Suudi Arabistan Riyali",
  SEK: "İsveç Kronu",
};

export function dovizKoduMu(deger: unknown): deger is DovizKodu {
  return typeof deger === "string" && (DOVIZ_CINSLERI as readonly string[]).includes(deger);
}
