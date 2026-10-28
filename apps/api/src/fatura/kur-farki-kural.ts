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

/**
 * KSB-27: ödenecek tutardan (matrah + KDV − tevkifat) matrahı bulur. KDV ve
 * tevkifat faturada kuruşa yuvarlandığından ±1 kuruş aranır.
 */
export function matrahBul(odenecek: Prisma.Decimal.Value, kdvOrani: Prisma.Decimal.Value, tevkifatOrani: Prisma.Decimal.Value = 0): Prisma.Decimal {
  const tutar = D(odenecek);
  const oran = D(kdvOrani).div(100);
  const t = D(tevkifatOrani);
  const yuvarla = (x: Prisma.Decimal) => x.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const odenen = (m: Prisma.Decimal) => { const kdv = yuvarla(m.mul(oran)); return m.add(kdv).sub(yuvarla(kdv.mul(t))); };
  const tahmin = yuvarla(tutar.div(D(1).add(oran.mul(D(1).sub(t)))));
  for (const adim of ["0", "0.01", "-0.01", "0.02", "-0.02"]) {
    const m = tahmin.add(adim);
    if (odenen(m).eq(tutar)) return m;
  }
  return tahmin;
}

export interface KurFarkiGrupGirdisi {
  kdvOrani: Prisma.Decimal.Value;
  gibIstisnaKodu: string | null;
  tevkifatKodu: string | null;
  tevkifatOrani: Prisma.Decimal.Value;
  agirlik: Prisma.Decimal.Value;
}

export interface KurFarkiKalemi {
  kurFarkiTry: Prisma.Decimal.Value;
  gruplar: KurFarkiGrupGirdisi[];
}

/**
 * KSB-27: her kalemin farkı asıl faturanın satır gruplarına (KDV oranı,
 * istisna kodu, tevkifat kodu) ödenecek tutar ağırlığıyla bölünür; aynı
 * gruplar tek kur farkı faturası satırında toplanır.
 */
export function kurFarkiSatirlari(kalemler: KurFarkiKalemi[]) {
  const gruplar = new Map<string, { kdvOrani: Prisma.Decimal; gibIstisnaKodu: string | null; tevkifatKodu: string | null; tevkifatOrani: Prisma.Decimal; kdvDahil: Prisma.Decimal }>();
  for (const k of kalemler) {
    const fark = D(k.kurFarkiTry).abs();
    const liste = k.gruplar.length ? k.gruplar : [{ kdvOrani: 20, gibIstisnaKodu: null, tevkifatKodu: null, tevkifatOrani: 0, agirlik: 1 }];
    const toplamAgirlik = liste.reduce((t, g) => t.add(D(g.agirlik)), D(0));
    let dagitilan = D(0);
    liste.forEach((g, i) => {
      const pay = i === liste.length - 1 ? fark.sub(dagitilan) : fark.mul(D(g.agirlik)).div(toplamAgirlik).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      dagitilan = dagitilan.add(pay);
      const oran = D(g.kdvOrani);
      const anahtar = `${oran.toFixed(2)}|${g.gibIstisnaKodu ?? ""}|${g.tevkifatKodu ?? ""}`;
      const grup = gruplar.get(anahtar) ?? { kdvOrani: oran, gibIstisnaKodu: g.gibIstisnaKodu, tevkifatKodu: g.tevkifatKodu, tevkifatOrani: D(g.tevkifatOrani), kdvDahil: D(0) };
      grup.kdvDahil = grup.kdvDahil.add(pay);
      gruplar.set(anahtar, grup);
    });
  }
  return [...gruplar.values()].filter((g) => g.kdvDahil.gt(0)).map((g) => ({ ...g, matrah: matrahBul(g.kdvDahil, g.kdvOrani, g.tevkifatOrani) }));
}
