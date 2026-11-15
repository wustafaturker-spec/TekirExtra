import { Prisma } from "@prisma/client";

/**
 * END-19: alacağın erime maliyeti. Bir alacak, doğduğu ayın endeksinden
 * tahsil edildiği (ya da hâlâ açıksa son açıklanan) ayın endeksine kadar
 * reel değer kaybeder: kayıp = tutar × (1 − E(doğuş) / E(tahsil)).
 * Endeksi henüz açıklanmamış ayda o aydan önceki son açıklanan değer
 * kullanılır. Hesap Decimal'dir; kuruşa yuvarlanır. Deflasyonda kayıp eksi
 * (kazanç) olur, kırpılmaz.
 */
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const ayAnahtari = (t: Date) => t.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7) + "-01";

/** Ayın değeri; yoksa o aydan önceki en son açıklanan ay. */
export function aySonDegeri(degerler: Map<string, D>, ay: string): { ay: string; deger: D } | null {
  let enIyi: string | null = null;
  for (const a of degerler.keys()) if (a <= ay && (enIyi === null || a > enIyi)) enIyi = a;
  return enIyi ? { ay: enIyi, deger: degerler.get(enIyi)! } : null;
}

export interface ErimeKalemi { dogus: Date; bitis: Date; tutar: Prisma.Decimal.Value }

export interface ErimeSonucu {
  /** Toplam reel kayıp (TL, kuruş). */
  kayip: string;
  /** Hesaba giren tutar (endeksi bulunan kalemler). */
  kapsanan: string;
  /** Endeksi bulunamadığı için dışarıda kalan kalem sayısı. */
  disarida: number;
  /** Hesapta kullanılan en son endeks ayı. */
  sonEndeksAyi: string | null;
}

export function erimeHesapla(kalemler: ErimeKalemi[], degerler: Map<string, D>): ErimeSonucu {
  let kayip = D(0), kapsanan = D(0), disarida = 0;
  let sonEndeksAyi: string | null = null;
  for (const k of kalemler) {
    const e0 = aySonDegeri(degerler, ayAnahtari(k.dogus)), e1 = aySonDegeri(degerler, ayAnahtari(k.bitis));
    if (!e0 || !e1) { disarida++; continue; }
    const tutar = D(k.tutar);
    kayip = kayip.add(tutar.mul(D(1).sub(e0.deger.div(e1.deger))));
    kapsanan = kapsanan.add(tutar);
    if (!sonEndeksAyi || e1.ay > sonEndeksAyi) sonEndeksAyi = e1.ay;
  }
  return { kayip: kayip.toDecimalPlaces(2).toFixed(2), kapsanan: kapsanan.toDecimalPlaces(2).toFixed(2), disarida, sonEndeksAyi };
}

/** Kalemlerin en eski doğuş ayı (endeks okuma aralığının başı). */
export function enEskiAy(kalemler: ErimeKalemi[]): string | null {
  return kalemler.length ? kalemler.map((k) => ayAnahtari(k.dogus)).sort()[0] : null;
}
