import type { KayitEylem } from "@tekirextra/shared";
import type { IstekBaglami } from "../istek-baglami";

/**
 * Kayıt eylem kural motoru (AYR-04..07, MIMARI §4.3).
 *
 * Her varlık türü, eylemlerinin (sil/duzenle/kopyala/iptal/pasife_al) hangi
 * koşulda izinli olduğunu tek yerden bildirir. Liste/detay API yanıtları
 * izinliEylemler() çıktısını kayıtla birlikte döner (AYR-06); mutasyon
 * uçları da AYNI politikayı eylemIzinli() ile zorlar — asıl denetim sunucuda.
 */
export type EylemKurali<T> = (kayit: T, ctx: IstekBaglami) => boolean;
export type EylemPolitikasi<T> = Partial<Record<KayitEylem, EylemKurali<T>>>;

const politikalar = new Map<string, EylemPolitikasi<unknown>>();

export function registerEylemPolitikasi<T>(
  varlik: string,
  politika: EylemPolitikasi<T>,
): void {
  if (politikalar.has(varlik)) {
    throw new Error(`'${varlik}' varlığının eylem politikası zaten kayıtlı`);
  }
  politikalar.set(varlik, politika as EylemPolitikasi<unknown>);
}

export function izinliEylemler<T>(
  varlik: string,
  kayit: T,
  ctx: IstekBaglami,
): KayitEylem[] {
  const politika = politikalar.get(varlik);
  if (!politika) return [];
  return (Object.entries(politika) as [KayitEylem, EylemKurali<unknown>][])
    .filter(([, kural]) => kural(kayit, ctx))
    .map(([eylem]) => eylem);
}

export function eylemIzinli<T>(
  varlik: string,
  eylem: KayitEylem,
  kayit: T,
  ctx: IstekBaglami,
): boolean {
  return izinliEylemler(varlik, kayit, ctx).includes(eylem);
}

/** Yalnızca testlerin kullandığı sıfırlama. */
export function _tumPolitikalariTemizle(): void {
  politikalar.clear();
}
