import { Prisma } from "@prisma/client";

export type SgkMatrahDevirKalemi = {
  tutar: number | string;
  kalanAy: 1 | 2;
};

export type SgkMatrahDevirGirdisi = {
  ucretPrimeEsasKazanc: number;
  ucretDisiOdeme: number;
  sgkTavan: number;
  devredenler?: SgkMatrahDevirKalemi[];
};

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const para = (deger: Prisma.Decimal) => deger.toDecimalPlaces(2);

/**
 * Ücret dışı ödemelerin SGK tavanını aşan kısmını, takip eden en fazla iki ay
 * boyunca kullanılabilecek devir kalemlerine ayırır. Eski devirler önce
 * tüketilir; ücretin kendisi hiçbir zaman sonraki aya devretmez.
 */
export function sgkMatrahDevriniHesapla(girdi: SgkMatrahDevirGirdisi) {
  const tavan = Prisma.Decimal.max(D(0), D(girdi.sgkTavan));
  const ucret = Prisma.Decimal.max(D(0), D(girdi.ucretPrimeEsasKazanc));
  const ucretDisi = Prisma.Decimal.max(D(0), D(girdi.ucretDisiOdeme));
  let kapasite = Prisma.Decimal.max(D(0), tavan.sub(Prisma.Decimal.min(ucret, tavan)));
  let devredenUygulanan = D(0);
  const sonrakiDonemDevirleri: SgkMatrahDevirKalemi[] = [];

  for (const kalem of girdi.devredenler ?? []) {
    const tutar = Prisma.Decimal.max(D(0), D(kalem.tutar));
    const uygulanan = Prisma.Decimal.min(tutar, kapasite);
    devredenUygulanan = devredenUygulanan.add(uygulanan);
    kapasite = kapasite.sub(uygulanan);
    const kalan = tutar.sub(uygulanan);
    if (kalan.gt(0) && kalem.kalanAy > 1) {
      sonrakiDonemDevirleri.push({ tutar: para(kalan).toFixed(2), kalanAy: 1 });
    }
  }

  const cariAyUygulanan = Prisma.Decimal.min(ucretDisi, kapasite);
  const cariAyDevreden = ucretDisi.sub(cariAyUygulanan);
  if (cariAyDevreden.gt(0)) {
    sonrakiDonemDevirleri.push({ tutar: para(cariAyDevreden).toFixed(2), kalanAy: 2 });
  }

  const primeEsasKazanc = Prisma.Decimal.min(tavan, ucret.add(devredenUygulanan).add(cariAyUygulanan));
  return {
    primeEsasKazanc: para(primeEsasKazanc).toFixed(2),
    devredenUygulanan: para(devredenUygulanan).toFixed(2),
    cariAyUcretDisiUygulanan: para(cariAyUygulanan).toFixed(2),
    cariAyDevreden: para(cariAyDevreden).toFixed(2),
    sonrakiDonemDevirleri,
  };
}

export function sgkDevirleriniDonemeTasi(
  devirler: SgkMatrahDevirKalemi[],
  kaynakYil: number,
  kaynakAy: number,
  hedefYil: number,
  hedefAy: number,
) {
  const ayFarki = (hedefYil - kaynakYil) * 12 + hedefAy - kaynakAy;
  if (ayFarki <= 0) return [];
  const atlananAy = ayFarki - 1;
  return devirler.flatMap((kalem) => {
    const kalanAy = kalem.kalanAy - atlananAy;
    return kalanAy >= 1 && kalanAy <= 2
      ? [{ tutar: kalem.tutar, kalanAy: kalanAy as 1 | 2 }]
      : [];
  });
}
