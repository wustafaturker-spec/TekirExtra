/**
 * STK-40: giderin alış satırlarına dağıtımı (saf kural). Ağırlık satırın TL
 * matrahı ("tutar") ya da ana birim miktarı ("miktar"); paylar kuruşa
 * yuvarlanır, yuvarlama farkı en büyük paya eklenir ki toplam tam tutsun.
 */
import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type DagitimYontemi = "tutar" | "miktar";

export interface DagitimSatiri {
  faturaSatirId: string;
  /** Satır matrahı × fatura kuru (TL). */
  matrahTl: Prisma.Decimal;
  /** Ana birim cinsinden miktar. */
  anaMiktar: Prisma.Decimal;
}

export function paylariHesapla<T extends DagitimSatiri>(tutar: Prisma.Decimal.Value, yontem: DagitimYontemi, satirlar: T[]): (T & { pay: Prisma.Decimal })[] {
  const toplam = D(tutar);
  const agirlik = (s: DagitimSatiri) => (yontem === "tutar" ? s.matrahTl : s.anaMiktar);
  const toplamAgirlik = satirlar.reduce((t, s) => t.add(agirlik(s)), D(0));
  if (!toplamAgirlik.gt(0)) throw new Error(yontem === "tutar" ? "Seçilen satırların tutarı sıfır; miktara göre dağıtın" : "Seçilen satırların miktarı sıfır");
  const paylar = satirlar.map((s) => ({ ...s, pay: toplam.mul(agirlik(s)).div(toplamAgirlik).toDecimalPlaces(2) }));
  const fark = toplam.sub(paylar.reduce((t, s) => t.add(s.pay), D(0)));
  if (!fark.isZero()) {
    const enBuyuk = paylar.reduce((a, b) => (b.pay.gt(a.pay) ? b : a));
    enBuyuk.pay = enBuyuk.pay.add(fark);
  }
  return paylar;
}
