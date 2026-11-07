import { type DovizKodu, dovizKoduMu } from "@tekirextra/shared";
import type { NormalizeKesinti } from "./trendyol.adapter";

/**
 * PZR-15: Trendyol cari hesap ekstresi (finance/che) kayıtlarından kesinti.
 * Kaynak: developers.trendyol.com "Cari Hesap Ekstresi Entegrasyonu" (2026-09-02).
 *
 * Yanıttaki `transactionType` Türkçe etikettir ("Satış"); türü güvenilir bilmek
 * için her tür ayrı sorgulanır ve istekteki İngilizce ad kullanılır.
 *
 * İşaretler belgedeki tablodan gelir (alan değerinin işaretine güvenilmez):
 * komisyon sütununda "-" satıcıdan alınan komisyon (kesinti +), "+" satıcıya
 * dönen komisyon (kesinti −). Hakediş düzeltmesinde satıcı geliri "+" ise
 * satıcı lehine (kesinti −).
 */

/** Komisyon yönü: +1 satıcıdan alınır, −1 satıcıya döner (belgedeki commissionAmount işareti). */
export const KOMISYON_YONU: Record<string, 1 | -1> = {
  Sale: 1, Return: -1,
  Discount: -1, DiscountCancel: 1, Coupon: -1, CouponCancel: 1,
  ProvisionPositive: 1, ProvisionNegative: -1,
  CommissionPositive: -1, CommissionNegative: 1, CommissionPositiveCancel: 1, CommissionNegativeCancel: -1,
  DeliveryFee: 1, DeliveryFeeCancel: -1,
};

/** Hakediş düzeltmesi yönü: +1 satıcı aleyhine (kesinti +), −1 satıcı lehine (kesinti −). */
export const DUZELTME_YONU: Record<string, 1 | -1> = {
  ProvisionPositive: -1, ProvisionNegative: 1,
  SellerRevenuePositive: -1, SellerRevenueNegative: 1, SellerRevenuePositiveCancel: 1, SellerRevenueNegativeCancel: -1,
};

/** Sorgulanan settlements türleri (müşteri ödemesi niteliğindeki tutarlar alınmaz; yalnız komisyon/düzeltme bileşeni). */
export const SETTLEMENT_TURLERI = [...new Set([...Object.keys(KOMISYON_YONU), ...Object.keys(DUZELTME_YONU)])];
/** Sorgulanan otherfinancials türleri. PaymentOrder PZR-16'nın; ReturnInvoice/CommissionAgreementInvoice faturanın kendisidir (e-Faturadan gelir). */
export const DIGER_FINANS_TURLERI = ["Stoppage", "DeductionInvoices"] as const;

const KOMISYON_ADI: Record<string, string> = {
  Sale: "Komisyon", Return: "Komisyon iadesi",
  Discount: "Komisyon (indirim)", DiscountCancel: "Komisyon (indirim iptali)", Coupon: "Komisyon (kupon)", CouponCancel: "Komisyon (kupon iptali)",
  ProvisionPositive: "Komisyon (provizyon)", ProvisionNegative: "Komisyon (provizyon)",
  CommissionPositive: "Komisyon düzeltmesi", CommissionNegative: "Komisyon düzeltmesi", CommissionPositiveCancel: "Komisyon düzeltmesi", CommissionNegativeCancel: "Komisyon düzeltmesi",
  DeliveryFee: "Komisyon (teslimat bedeli)", DeliveryFeeCancel: "Komisyon (teslimat bedeli iptali)",
};

/** Belgedeki finans kaydı (yalnız kullanılan alanlar). */
export interface TrendyolFinansKaydi {
  id: string | number;
  transactionDate?: number | null;
  transactionType?: string | null;
  description?: string | null;
  debt?: number | null;
  credit?: number | null;
  commissionAmount?: number | null;
  sellerRevenue?: number | null;
  orderNumber?: string | number | null;
  paymentOrderId?: string | number | null;
  receiptId?: string | number | null;
  currency?: string | null;
  [alan: string]: unknown;
}

const yuvarla = (v: number) => Math.round(v * 100) / 100;
const mutlak = (v: unknown) => Math.abs(Number(v ?? 0) || 0);

/** Epoch ms → İstanbul takvim günü (YYYY-MM-DD). */
export function istanbulGunu(ms: number): string {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
}

function ortak(k: TrendyolFinansKaydi, tur: string) {
  const doviz: DovizKodu = k.currency && dovizKoduMu(k.currency) ? k.currency : "TRY";
  return {
    siparisNo: k.orderNumber != null && String(k.orderNumber) ? String(k.orderNumber) : undefined,
    aciklama: [k.transactionType, k.description].filter(Boolean).join(" · ").slice(0, 500) || undefined,
    tarih: istanbulGunu(Number(k.transactionDate ?? Date.now())),
    dovizCinsi: doviz,
    hamVeri: { kaynak: tur, ...k },
  };
}

/** settlements kaydından komisyon ve (varsa) hakediş düzeltmesi kesintileri. */
export function settlementKesintileri(tur: string, k: TrendyolFinansKaydi): NormalizeKesinti[] {
  const sonuc: NormalizeKesinti[] = [];
  const temel = ortak(k, tur);
  const komisyon = mutlak(k.commissionAmount);
  const kYon = KOMISYON_YONU[tur];
  if (kYon && komisyon > 0) sonuc.push({ ...temel, hariciId: `ty:s:${k.id}:komisyon`, tur: KOMISYON_ADI[tur] ?? "Komisyon", tutar: yuvarla(kYon * komisyon) });
  const dYon = DUZELTME_YONU[tur];
  if (dYon) {
    // Provizyonda satıcı geliri komisyon düşülmüş tutardır; komisyon ayrıca kaydedildiği için düzeltme brüttür.
    const brut = mutlak(k.sellerRevenue) + (tur.startsWith("Provision") ? komisyon : 0);
    if (brut > 0) sonuc.push({ ...temel, hariciId: `ty:s:${k.id}:duzeltme`, tur: "Hakediş düzeltmesi", tutar: yuvarla(dYon * brut) });
  }
  return sonuc;
}

/** otherfinancials kaydından kesinti: borç satıcı aleyhine (+), alacak satıcı lehine (−). */
export function digerFinansKesintisi(tur: (typeof DIGER_FINANS_TURLERI)[number], k: TrendyolFinansKaydi): NormalizeKesinti | null {
  const tutar = yuvarla(Number(k.debt ?? 0) - Number(k.credit ?? 0));
  if (!tutar) return null;
  const temel = ortak(k, tur);
  if (tur === "Stoppage") return { ...temel, hariciId: `ty:o:${k.id}:stopaj`, tur: "E-ticaret stopajı", tutar };
  const ad = String(k.transactionType ?? "").trim() || "Trendyol hizmet faturası";
  return { ...temel, hariciId: `ty:o:${k.id}:kesinti`, tur: ad.slice(0, 80), aciklama: [temel.aciklama, `Belge ${k.id}`].filter(Boolean).join(" · ").slice(0, 500), tutar };
}

/**
 * Çekim pencereleri: servis en çok 15 günlük aralık kabul eder. Son bitişten
 * 15 gün geri başlanır (finans kaydı teslimden sonra oluşur; geç düşen kayıt
 * kaçmasın), ilk çekim 90 gün geri gider.
 */
export const PENCERE_MS = 15 * 86_400_000;
export function cekimPencereleri(sonBitis: number | null, simdi: number, ilkGun = 90): { baslangic: number; bitis: number }[] {
  const ilk = simdi - ilkGun * 86_400_000;
  let baslangic = sonBitis ? Math.max(ilk, sonBitis - PENCERE_MS) : ilk;
  const pencereler: { baslangic: number; bitis: number }[] = [];
  while (baslangic < simdi) {
    const bitis = Math.min(simdi, baslangic + PENCERE_MS - 1);
    pencereler.push({ baslangic, bitis });
    baslangic = bitis + 1;
  }
  return pencereler;
}
