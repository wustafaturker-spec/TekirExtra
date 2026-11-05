import { Prisma } from "@prisma/client";

export const ABONELIK_SURELERI = [1, 3, 6, 12] as const;
export type AbonelikSuresi = (typeof ABONELIK_SURELERI)[number];

/** Dönem tutarı aylık birim fiyat değil, dönemin tamamının KDV hariç bedelidir. */
export interface PaketFiyatSozlesmesi {
  paraBirimi: "TRY";
  vergiDahil: false;
  kdvOrani: string;
  donemler: readonly { aySayisi: AbonelikSuresi; matrah: string }[];
}

const ondalik = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

/** JSON/DB'den gelen sözleşmeler hesap yapılmadan önce bütünüyle doğrulanır. */
export function paketFiyatiHesapla(sozlesme: PaketFiyatSozlesmesi, aySayisi: AbonelikSuresi) {
  if (!sozlesme || sozlesme.paraBirimi !== "TRY" || sozlesme.vergiDahil !== false) {
    throw new Error("Yalnız TRY ve KDV hariç fiyat sözleşmesi destekleniyor.");
  }
  if (typeof sozlesme.kdvOrani !== "string" || !ondalik.test(sozlesme.kdvOrani) || new Prisma.Decimal(sozlesme.kdvOrani).gt(100)) {
    throw new Error("Geçersiz KDV oranı.");
  }
  if (!Array.isArray(sozlesme.donemler) || !sozlesme.donemler.length || sozlesme.donemler.length > ABONELIK_SURELERI.length) {
    throw new Error("En az bir desteklenen dönem fiyatı gerekir.");
  }
  const gorulen = new Set<number>();
  for (const donem of sozlesme.donemler) {
    if (!donem || !ABONELIK_SURELERI.includes(donem.aySayisi) || gorulen.has(donem.aySayisi)) {
      throw new Error("Geçersiz veya tekrarlanan fiyat dönemi.");
    }
    gorulen.add(donem.aySayisi);
    if (typeof donem.matrah !== "string" || !ondalik.test(donem.matrah)) {
      throw new Error("Dönem bedeli en fazla iki ondalıklı, negatif olmayan tutar olmalıdır.");
    }
  }
  const donem = sozlesme.donemler.find((d) => d.aySayisi === aySayisi);
  if (!donem) throw new Error("Seçilen dönem için fiyat tanımlı değil.");
  const matrah = new Prisma.Decimal(donem.matrah);
  const kdv = matrah.mul(sozlesme.kdvOrani).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { matrah, kdv, toplam: matrah.add(kdv) };
}
