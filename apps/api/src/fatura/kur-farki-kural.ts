/**
 * KSB-07: gerçekleşen kur farkının saf kuralları (yön ve fatura satırları).
 */
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

export type KurFarkiYonu = "biz_keseriz" | "karsi_taraf_keser";

/**
 * Faturayı kimin keseceği. `farkTry` = ödeme günü TL değeri − fatura kurundaki
 * TL değeri. Tahsilatta artı fark, ödemede eksi fark lehimizedir; lehimize
 * farkta faturayı biz keseriz, aleyhimize farkta karşı taraf keser.
 */
export function kurFarkiYonu(hareketTipi: string, farkTry: Prisma.Decimal.Value): KurFarkiYonu {
  const fark = D(farkTry);
  const lehimize = hareketTipi === "tahsilat" ? fark.gt(0) : fark.lt(0);
  return lehimize ? "biz_keseriz" : "karsi_taraf_keser";
}

/**
 * KDV dahil tutardan matrahı iç yüzdeyle ayırır. Satır KDV'si faturada
 * kuruşa yuvarlanarak hesaplandığından matrah, `matrah + KDV` tam olarak
 * KDV dahil tutara eşit olacak biçimde ±1 kuruş düzeltilir.
 */
export function icYuzdeMatrah(kdvDahil: Prisma.Decimal.Value, kdvOrani: Prisma.Decimal.Value): Prisma.Decimal {
  const tutar = D(kdvDahil);
  const oran = D(kdvOrani).div(100);
  const kdv = (m: Prisma.Decimal) => m.mul(oran).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const tahmin = tutar.div(oran.add(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  for (const adim of ["0", "0.01", "-0.01"]) {
    const m = tahmin.add(adim);
    if (m.add(kdv(m)).eq(tutar)) return m;
  }
  return tahmin;
}

export interface KurFarkiKalemi {
  kurFarkiTry: Prisma.Decimal.Value;
  kdvOrani: Prisma.Decimal.Value;
  gibIstisnaKodu: string | null;
}

/** Aynı KDV oranı/istisna kodundaki farkları tek fatura satırında toplar. */
export function kurFarkiSatirlari(kalemler: KurFarkiKalemi[]) {
  const gruplar = new Map<string, { kdvOrani: Prisma.Decimal; gibIstisnaKodu: string | null; kdvDahil: Prisma.Decimal }>();
  for (const k of kalemler) {
    const oran = D(k.kdvOrani);
    const anahtar = `${oran.toFixed(2)}|${k.gibIstisnaKodu ?? ""}`;
    const grup = gruplar.get(anahtar) ?? { kdvOrani: oran, gibIstisnaKodu: k.gibIstisnaKodu, kdvDahil: D(0) };
    grup.kdvDahil = grup.kdvDahil.add(D(k.kurFarkiTry).abs());
    gruplar.set(anahtar, grup);
  }
  return [...gruplar.values()].map((g) => ({ ...g, matrah: icYuzdeMatrah(g.kdvDahil, g.kdvOrani) }));
}
