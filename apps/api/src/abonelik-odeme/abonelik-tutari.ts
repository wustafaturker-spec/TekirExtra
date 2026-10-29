import { Prisma } from "@prisma/client";
import { ABONELIK_PLANLARI, VARSAYILAN_PLAN_KODU } from "../tenant/abonelik.service";

/** PLT-12: ödeme süreleri (PLT-09 elle tahsilatla aynı). */
export const ABONELIK_SURELERI = [1, 3, 6, 12] as const;
export type AbonelikSuresi = (typeof ABONELIK_SURELERI)[number];

/** PLT-12: katalog fiyatları KDV hariçtir; tahsilata %20 KDV eklenir. */
export const ABONELIK_KDV_ORANI = 20;

export interface AbonelikTutari {
  planKodu: string;
  planAdi: string;
  aySayisi: AbonelikSuresi;
  matrah: Prisma.Decimal;
  kdv: Prisma.Decimal;
  toplam: Prisma.Decimal;
}

/** Eski kayıtlardaki "v1" Profesyonel plan sayılır (AbonelikService ile aynı kural). */
export const fiyatPlani = (planKodu: string) => ABONELIK_PLANLARI.find((p) => p.kod === (planKodu === VARSAYILAN_PLAN_KODU ? "profesyonel" : planKodu));

/** Fiyatı olmayan plan (Kurumsal) ya da bilinmeyen plan için null: yalnız elle tahsil edilir. */
export function abonelikTutari(planKodu: string, aySayisi: AbonelikSuresi): AbonelikTutari | null {
  const plan = fiyatPlani(planKodu);
  if (!plan || plan.aylikFiyat === null) return null;
  const matrah = new Prisma.Decimal(plan.aylikFiyat).mul(aySayisi).toDecimalPlaces(2);
  const kdv = matrah.mul(ABONELIK_KDV_ORANI).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { planKodu: plan.kod, planAdi: plan.ad, aySayisi, matrah, kdv, toplam: matrah.add(kdv) };
}

export const tlYaz = (d: Prisma.Decimal | number) =>
  Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
