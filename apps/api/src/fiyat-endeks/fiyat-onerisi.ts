import { Prisma } from "@prisma/client";
import { ayKaydir } from "./fiyat-endeks-hesap";

/**
 * END-16: endekse göre fiyat güncelleme önerisinin saf hesabı. Öneri son
 * fiyat değişikliğinden bu yana seçili endeksin değişimi kadardır; kendiliğinden
 * fiyat değiştirmez, ekran önizler ve kullanıcı onaylarsa mevcut fiyat listesi
 * uçlarıyla uygular.
 */
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const YUVARLAMALAR = ["yok", "kurus", "tam", "bes", "on"] as const;
export type Yuvarlama = (typeof YUVARLAMALAR)[number];
const ADIM: Record<Yuvarlama, D> = { yok: D("0.0001"), kurus: D("0.01"), tam: D(1), bes: D(5), on: D(10) };

/** En yakın adıma (yarım yukarı); sıfıra yuvarlanan pozitif fiyat bir adım olur. */
export function yuvarla(f: D, kural: Yuvarlama): D {
  const adim = ADIM[kural];
  const y = f.div(adim).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(adim);
  return y.lte(0) && f.gt(0) ? adim : y;
}

/** Fiyatın belirlendiği ay bilinen son endeksi içerir: değişiklik ayından önceki ay baz alınır. */
export function bazAyi(degisiklik: Date): string {
  const ay = degisiklik.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";
  return ayKaydir(ay, -1);
}

export interface OneriSatiri {
  durum: "oneri" | "degisim_yok" | "baz_yok" | "endeks_yok";
  bazAy: string | null;
  sonAy: string | null;
  endeksDegisim: string | null;
  yeniFiyat: string | null;
  fark: string | null;
  neden: string | null;
}

export function oneriHesapla(eski: D, bazAy: string | null, sonAy: string | null, endeks: Map<string, D>, kural: Yuvarlama): OneriSatiri {
  const bos = { bazAy, sonAy, endeksDegisim: null, yeniFiyat: null, fark: null };
  if (!bazAy) return { ...bos, durum: "baz_yok", neden: "Bu kalemin fiyat geçmişi yok; varsayılan baz ay seçin." };
  if (!sonAy || bazAy >= sonAy) return { ...bos, durum: "degisim_yok", neden: "Son fiyat değişikliğinden sonra yeni endeks açıklanmadı." };
  const b = endeks.get(bazAy), s = endeks.get(sonAy);
  if (!b || !s) return { ...bos, durum: "endeks_yok", neden: `${(b ? sonAy : bazAy).slice(0, 7)} için endeks değeri yok.` };
  const oran = s.div(b);
  const yeni = yuvarla(eski.mul(oran), kural);
  return { bazAy, sonAy, durum: "oneri", endeksDegisim: oran.sub(1).mul(100).toDecimalPlaces(2).toFixed(2), yeniFiyat: yeni.toFixed(4), fark: yeni.sub(eski).toFixed(4), neden: null };
}
