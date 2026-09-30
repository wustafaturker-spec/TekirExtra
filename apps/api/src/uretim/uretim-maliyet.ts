import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export type YanUrunMaliyetYontemi = "sifir" | "sabit_deger" | "satis_degeri";

export interface DagitimCiktisi {
  miktar: Prisma.Decimal;
  /** Sabit değer yönteminde reçetedeki birim maliyet. */
  birimMaliyet: Prisma.Decimal | null;
  /** Satış değeri yönteminde stok kartının TL satış fiyatı. */
  satisFiyati: Prisma.Decimal | null;
}

/**
 * Bir üretim bildiriminin toplam maliyetini (malzeme + operasyon payı) ana
 * ürün ile yan/ortak ürünler arasında böler ve birim maliyetleri döner.
 *
 * - sifir: yan ürünler maliyetsiz girer, tamamı ana ürüne kalır.
 * - sabit_deger: yan ürün reçetedeki birim değeriyle girer, o tutar ana
 *   üründen düşülür. Toplamı aşarsa yan ürün değerleri orantılı küçültülür;
 *   ana ürün sıfırın altına inmez, yoktan değer doğmaz.
 * - satis_degeri: toplam, miktar × satış fiyatı ağırlığıyla paylaştırılır.
 */
export function maliyetDagit(girdi: {
  toplam: Prisma.Decimal;
  mamulMiktar: Prisma.Decimal;
  mamulSatisFiyati: Prisma.Decimal | null;
  yontem: YanUrunMaliyetYontemi;
  ciktilar: DagitimCiktisi[];
}): { mamulBirimMaliyeti: Prisma.Decimal; ciktiBirimMaliyetleri: Prisma.Decimal[] } {
  const { toplam, mamulMiktar, yontem, ciktilar } = girdi;
  let ciktiTutarlari = ciktilar.map(() => D(0));

  if (ciktilar.length && yontem === "sabit_deger") {
    ciktiTutarlari = ciktilar.map((c) => c.miktar.mul(c.birimMaliyet ?? 0));
    const sabitToplam = ciktiTutarlari.reduce((t, v) => t.add(v), D(0));
    if (sabitToplam.gt(toplam)) ciktiTutarlari = ciktiTutarlari.map((v) => v.mul(toplam).div(sabitToplam));
  }

  if (ciktilar.length && yontem === "satis_degeri") {
    const mamulAgirlik = mamulMiktar.mul(girdi.mamulSatisFiyati ?? 0);
    const agirliklar = ciktilar.map((c) => c.miktar.mul(c.satisFiyati ?? 0));
    const toplamAgirlik = agirliklar.reduce((t, v) => t.add(v), mamulAgirlik);
    if (mamulAgirlik.lte(0) || toplamAgirlik.lte(0)) {
      throw new BadRequestException("Satış değerine göre pay için ana ürünün ve yan ürünlerin TL satış fiyatı tanımlı olmalı");
    }
    ciktiTutarlari = agirliklar.map((a) => toplam.mul(a).div(toplamAgirlik));
  }

  const ciktiToplami = ciktiTutarlari.reduce((t, v) => t.add(v), D(0));
  const mamulPayi = Prisma.Decimal.max(D(0), toplam.sub(ciktiToplami));
  return {
    mamulBirimMaliyeti: mamulMiktar.isZero() ? D(0) : mamulPayi.div(mamulMiktar).toDecimalPlaces(4),
    ciktiBirimMaliyetleri: ciktiTutarlari.map((v, i) => (ciktilar[i].miktar.isZero() ? D(0) : v.div(ciktilar[i].miktar).toDecimalPlaces(4))),
  };
}

/** Planlanan operasyon maliyeti: süre × saatlik maliyet; iptal edilen adımlar hariç. */
export function planlananOperasyonMaliyeti(operasyonlar: { planlananDakika: Prisma.Decimal; saatlikMaliyet: Prisma.Decimal; durum?: string }[]) {
  return operasyonlar.filter((o) => o.durum !== "iptal").reduce((t, o) => t.add(D(o.planlananDakika).mul(o.saatlikMaliyet).div(60)), D(0));
}
