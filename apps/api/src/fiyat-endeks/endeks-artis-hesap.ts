import { Prisma } from "@prisma/client";
import { ayKaydir } from "./fiyat-endeks-hesap";

/**
 * END-17: kira tahakkuku ve tekrarlayan faturada endeksli artış önerisinin
 * saf hesabı. Ölçüler:
 * - yillik: son ayın endeksi / 12 ay önceki endeks − 1
 * - oniki_ay_ortalama: son 12 ayın ortalaması / önceki 12 ayın ortalaması − 1
 *   (TÜİK'in "on iki aylık ortalamalara göre değişim"i)
 * Son ay, artış ayından önceki aydır (artış ayında açıklanan son endeks).
 * Üst sınır yüzdesi varsa oran onunla kırpılır; oran eksiyse artış yapılmaz.
 */
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const ARTIS_OLCULERI = ["yillik", "oniki_ay_ortalama"] as const;
export type ArtisOlcusu = (typeof ARTIS_OLCULERI)[number];

/** Artış yılının artış ayından önceki ay (YYYY-MM-01). */
export function artisSonAyi(yil: number, artisAyi: number): string {
  return ayKaydir(`${yil}-${String(artisAyi).padStart(2, "0")}-01`, -1);
}

/** Hesap için gereken aylar. */
export function gerekenAylar(olcu: ArtisOlcusu, sonAy: string): string[] {
  const adet = olcu === "yillik" ? 13 : 24;
  return Array.from({ length: adet }, (_, i) => ayKaydir(sonAy, -i));
}

export interface ArtisHesabi {
  sonAy: string;
  olcu: ArtisOlcusu;
  /** Kırpılmamış oran (yüzde, iki ondalık). */
  hesaplananOran: string;
  /** Üst sınır ve eksi kuralından sonra uygulanan oran (yüzde, iki ondalık). */
  uygulananOran: string;
  kirpildi: boolean;
  /** Hesapta kullanılan dönem ve değerler (kayıtta saklanır). */
  kullanilan: { ay: string; deger: string }[];
  ortalamalar?: { son12: string; onceki12: string };
}

/** Değer eksikse null (endeks henüz açıklanmamış ya da seri o tarihi kapsamıyor). */
export function artisHesapla(olcu: ArtisOlcusu, sonAy: string, degerler: Map<string, D>, ustSinir: D | null): ArtisHesabi | null {
  const aylar = gerekenAylar(olcu, sonAy);
  // Yıllıkta yalnız iki uç ay, ortalamada 24 ayın hepsi gerekir.
  const zorunlu = olcu === "yillik" ? [sonAy, ayKaydir(sonAy, -12)] : aylar;
  if (zorunlu.some((a) => !degerler.has(a))) return null;
  let oran: D;
  let ortalamalar: ArtisHesabi["ortalamalar"];
  if (olcu === "yillik") {
    oran = degerler.get(sonAy)!.div(degerler.get(ayKaydir(sonAy, -12))!).sub(1);
  } else {
    const ort = (liste: string[]) => liste.reduce((t, a) => t.add(degerler.get(a)!), D(0)).div(liste.length);
    const son12 = ort(aylar.slice(0, 12)), onceki12 = ort(aylar.slice(12, 24));
    oran = son12.div(onceki12).sub(1);
    ortalamalar = { son12: son12.toDecimalPlaces(6).toFixed(6), onceki12: onceki12.toDecimalPlaces(6).toFixed(6) };
  }
  const yuzde = oran.mul(100).toDecimalPlaces(2);
  let uygulanan = yuzde.lt(0) ? D(0) : yuzde;
  const kirpildi = ustSinir !== null && uygulanan.gt(ustSinir);
  if (kirpildi) uygulanan = ustSinir!;
  const kullanilan = (olcu === "yillik" ? [ayKaydir(sonAy, -12), sonAy] : [...aylar].reverse()).map((ay) => ({ ay, deger: degerler.get(ay)!.toFixed(6) }));
  return { sonAy, olcu, hesaplananOran: yuzde.toFixed(2), uygulananOran: uygulanan.toFixed(2), kirpildi: kirpildi || yuzde.lt(0), kullanilan, ...(ortalamalar ? { ortalamalar } : {}) };
}

/** Yeni bedel: eski × (1 + oran/100), kuruşa yuvarlanır. */
export function yeniBedel(eski: D, uygulananOran: string): D {
  return eski.mul(D(uygulananOran).div(100).add(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
