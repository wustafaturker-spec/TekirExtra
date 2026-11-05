import { Prisma } from "@prisma/client";
import { ABONELIK_PLANLARI, VARSAYILAN_PLAN_KODU } from "../tenant/abonelik-planlari";
import { ABONELIK_SURELERI, AbonelikSuresi, paketFiyatiHesapla } from "./paket-fiyat-sozlesmesi";

/** PLT-12: ödeme süreleri (PLT-09 elle tahsilatla aynı). */
export { ABONELIK_SURELERI, type AbonelikSuresi } from "./paket-fiyat-sozlesmesi";

/** PLT-12: katalog fiyatları KDV hariçtir; tahsilata %20 KDV eklenir. */
export const ABONELIK_KDV_ORANI = 20;

export interface AbonelikTutari {
  paketSurumId?: string;
  fiyatKaynagi?: "eski_plan_gecisi" | "katalog_atamasi";
  kdvOrani?: string;
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
  const aylikFiyat = plan.aylikFiyat;
  const tutar = paketFiyatiHesapla({
    paraBirimi: "TRY", vergiDahil: false, kdvOrani: String(ABONELIK_KDV_ORANI),
    donemler: ABONELIK_SURELERI.map((ay) => ({ aySayisi: ay, matrah: new Prisma.Decimal(aylikFiyat).mul(ay).toFixed(2) })),
  }, aySayisi);
  return { planKodu: plan.kod, planAdi: plan.ad, aySayisi, ...tutar };
}

export const tlYaz = (d: Prisma.Decimal | number) =>
  Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
