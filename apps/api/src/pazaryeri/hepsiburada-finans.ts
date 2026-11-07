import { createHash } from "node:crypto";
import type { DovizKodu } from "@tekirextra/shared";
import type { KesintiSinifi } from "./pazaryeri-kesinti-sinifi";
import type { NormalizeKesinti } from "./trendyol.adapter";
import { istanbulGunu } from "./trendyol-finans";

/**
 * PZR-21: Hepsiburada Kayıt Bazlı Muhasebe Servisi kayıtlarından kesinti.
 * Kaynak: Hepsiburada API Portal "Muhasebe Önemli Bilgiler" (05.06.2026),
 * kullanıcının ekran görüntüleri (docs/Hepsiburada/, commit edilmez).
 *
 * - İşaret yalnız `IsIncome`dan: gelir (satıcı lehine) → eksi kesinti, gider → artı.
 * - Sınıf ve Türkçe ad **kod adından** (belgede bazı açıklamalar yer değiştirmiş).
 * - Belgede yanıt örneği yok: tutar ve kayıt kimliği alanı aday adlarla aranır
 *   (büyük/küçük harf duyarsız); tutar bulunamazsa çekim durur, ham örnek hataya yazılır.
 */

/** Kesinti olmayan (müşteri ödemesi) kayıtlar: hakediş netinde sipariş tarafı. */
export const HB_SIPARIS_TIPLERI = new Set(["Payment", "Return", "BnplOrder", "BnplRefund"]);

type Eslem = { ad: string; sinif: KesintiSinifi };
const f = (ad: string): Eslem => ({ ad, sinif: "faturali" });
const s = (ad: string): Eslem => ({ ad, sinif: "stopaj" });
const u = (ad: string): Eslem => ({ ad, sinif: "siniflandirilmamis" });

/** Kod → Türkçe ad + sınıf. Tabloda olmayan kod sınıflandırılmamış gelir. */
export const HB_KAYIT_TIPLERI: Record<string, Eslem> = {
  // Stopaj
  Stoppage: s("E-ticaret stopajı"), StoppageRefund: s("E-ticaret stopajı iadesi"),
  GoldLaborStoppage: s("Altın işçilik bedeli stopajı"), GoldLaborStoppageRefund: s("Altın işçilik bedeli stopajı iadesi"),
  // Hepsiburada'nın kestiği faturalar (gider e-Faturadan)
  Commission: f("Komisyon"), CommissionRefund: f("Komisyon iadesi"), CommissionCorrection: f("Komisyon düzeltme"), OverseasCommissionRefund: f("Yurt dışı komisyon iadesi"),
  DeliveryProcessingFee: f("İşlem bedeli"), DeliveryProcessingFeeRefund: f("İşlem bedeli iadesi"), ReturnDeliveryProcessingFee: f("İşlem bedeli (iade sipariş)"),
  ProcessingFeeExpense: f("Hizmet bedeli"), ProcessingFeeExpenseRefund: f("Hizmet bedeli iadesi"), ReturnProcessingFeeExpense: f("Hizmet bedeli (iade sipariş)"),
  BnplProcessingFee: f("BNPL işlem ücreti"), BnplProcessingFeeRefund: f("BNPL işlem ücreti iadesi"),
  PaymentServiceCostReflection: f("Ödeme servisi maliyet yansıtma"), PaymentServiceCostReflectionRefund: f("Ödeme servisi maliyet yansıtma iadesi"),
  ShipmentCostSharingExpense: f("Kargo katkı payı gideri"), ShipmentCostSharingIncome: f("Kargo katkı payı iadesi"),
  DropShipmentCostSharingExpense: f("Drop kargo katkı payı gideri"), DropShipmentCostSharingIncome: f("Drop kargo katkı payı iadesi"),
  ReturnShipmentCostSharingExpense: f("Kargo bedeli (iade sipariş)"), CargoMargin: f("Kargo marjı"),
  MarketingExpense: f("Pazarlama bedeli"), MarketingExpenseRefund: f("Pazarlama bedeli iadesi"),
  AdSharingExpense: f("Reklam katılım gideri"), AdSharingExpenseRefund: f("Reklam katılım gideri iadesi"), FacebookAdExpense: f("Facebook reklam gideri"),
  MarketingSupportParticipation: f("Pazarlama destek katılım"), MarketingSupportParticipationRefund: f("Pazarlama destek katılım iadesi"),
  SponsorshipFee: f("Sponsorluk bedeli"), StudioExpense: f("Stüdyo kullanım bedeli"),
  TransportExpense: f("Taşıma gideri"), TransportExpenseRefund: f("Taşıma gideri iadesi"),
  RoadAssistanceExpense: f("Yol yardım bedeli"), RoadAssistanceExpenseRefund: f("Yol yardım iadesi"),
  LateInterestExpense: f("Vade farkı gideri"), SfsInterest: f("TFS vade farkı"),
  PriceDifferenceExpense: f("Fiyat farkı bedeli"), PriceDifferenceRefund: f("Fiyat farkı iadesi"),
  CustomerSatisfaction: f("Müşteri memnuniyeti yansıtma"), CustomerSatisfactionRefund: f("Müşteri memnuniyeti yansıtma iadesi"),
  LineItemTransferExpense: f("Sipariş transfer gideri"), Chargeout: f("Masraf yansıtma"), RevenueExpense: f("Ciro gideri"),
  Deposit: f("Depozito"), VAT: f("KDV faturası"), MpScrapExpense: f("Hurda gideri"),
  // Satıcının Hepsiburada'ya kestiği faturalar, düzeltmeler, reklam bakiyesi, e-Fatura satış kalemleri: kullanıcı seçer
  CampaignDiscount: u("Kampanya indirimi"), CampaignDiscountRefund: u("Kampanya indirimi iadesi"), CommissionInvoiceRefund: u("Komisyon iade faturası"),
  RevenueIncome: u("Ciro geliri"), MpScrapIncome: u("Hurda geliri"), LineItemTransferIncome: u("Sipariş transfer geliri"),
  CargoCompensationIncome: u("Kargo tazmin geliri"), CargoCompensationIncomeRefund: u("Kargo tazmin geliri iadesi"), CargoCompensationExpenseRefund: u("Kargo tazmin gideri iadesi"),
  CargoCompensationSellerSatisfactionIncome: u("Kargo tazmin satıcı memnuniyet geliri"), CargoLimitExcessCompensationIncome: u("Kargo limit aşımı tazmin geliri"),
  CargoCostRefund: u("Kargo iade"), MpCompensationIncome: u("MP operasyon tazmin geliri"),
  RefusedInvoiceExpense: u("Reddedilen fatura bedeli"), RefusedInvoiceExpenseRefund: u("Reddedilen fatura iadesi"),
  BalanceCorrection: u("Düzeltme kaydı"), AdBalanceTopUpFromAllowance: u("Reklam bakiyesi yükleme"), AdBalanceTopUpFromAllowanceRefund: u("Reklam bakiyesi iadesi"),
  EInvoiceSales: u("E-Fatura satış kalemi"), EInvoiceSalesRefund: u("E-Fatura satış tutarı iadesi"), MpOutletProductExpense: u("MP outlet ürün gideri"),
  InvoiceReversalIncome: u("Fatura ters kayıt geliri"), InvoiceReversalExpense: u("Fatura ters kayıt gideri"),
  ProductsReportedByService: u("MP servis raporlu ürünler"), TotalPayment: u("Toplam ödeme"),
};

/** Kodun Türkçe adı ve sınıfı; tabloda yoksa sınıflandırılmamış. */
export function hbKayitTipi(kod: string): Eslem {
  return HB_KAYIT_TIPLERI[kod] ?? u(`Hepsiburada: ${kod}`.slice(0, 80));
}

/** Büyük/küçük harf duyarsız alan okuma (belge hem `IsIncome` hem `isIncome` yazıyor). */
export function alan(kayit: Record<string, unknown>, ...adlar: string[]): unknown {
  const anahtarlar = new Map(Object.keys(kayit).map((k) => [k.toLowerCase(), k]));
  for (const ad of adlar) { const k = anahtarlar.get(ad.toLowerCase()); if (k !== undefined && kayit[k] !== null && kayit[k] !== undefined && kayit[k] !== "") return kayit[k]; }
  return undefined;
}

/** Tutar alanı aday adları (yanıt örneği belgede yok; ilk gerçek yanıtla doğrulanacak). */
export const TUTAR_ALANLARI = ["amount", "totalAmount", "transactionAmount", "netAmount", "price"];
const KIMLIK_ALANLARI = ["id", "transactionId", "recordId"];

export class HbYanitHatasi extends Error {}

export interface HbKayit {
  kimlik: string; kod: string; gelir: boolean; tutar: number; doviz: DovizKodu;
  siparisNo?: string; paketNo?: string; belgeNo?: string; durum?: string;
  kayitGunu: string; odemeGunu?: string; ham: Record<string, unknown>;
}

const metin = (v: unknown) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);
function gun(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const t = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(t.getTime()) ? undefined : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : istanbulGunu(t.getTime()));
}
const DOVIZ: Record<string, DovizKodu> = { "949": "TRY", "840": "USD", TRY: "TRY", USD: "USD" };

/** Ham kaydı okur; tutar ya da tip yoksa ham örnekle hata. */
export function hbKaydiOku(ham: Record<string, unknown>): HbKayit {
  const kod = metin(alan(ham, "transactionType", "recordType", "type"));
  const tutarHam = alan(ham, ...TUTAR_ALANLARI);
  const tutar = typeof tutarHam === "object" && tutarHam ? Number(alan(tutarHam as Record<string, unknown>, "amount", "value")) : Number(tutarHam);
  if (!kod || !Number.isFinite(tutar)) throw new HbYanitHatasi(`Hepsiburada finans yanıtı tanınamadı (kayıt tipi ya da tutar alanı yok). Örnek: ${JSON.stringify(ham).slice(0, 800)}`);
  const kayitGunu = gun(alan(ham, "recordDate", "transactionDate", "createdDate", "orderDate", "dueDate"));
  if (!kayitGunu) throw new HbYanitHatasi(`Hepsiburada finans kaydında tarih alanı tanınamadı. Örnek: ${JSON.stringify(ham).slice(0, 800)}`);
  const siparisNo = metin(alan(ham, "orderNumber")); const paketNo = metin(alan(ham, "packageNumber")); const belgeNo = metin(alan(ham, "referenceDocument", "invoiceNumber"));
  const gelirHam = alan(ham, "isIncome");
  const kimlik = metin(alan(ham, ...KIMLIK_ALANLARI))
    ?? createHash("sha256").update([kod, belgeNo, siparisNo, paketNo, metin(alan(ham, "sku")), kayitGunu, tutar].join("|")).digest("hex").slice(0, 32);
  return {
    kimlik, kod, gelir: gelirHam === true || String(gelirHam).toLowerCase() === "true", tutar: Math.abs(tutar),
    doviz: DOVIZ[String(alan(ham, "currencyCode", "currency") ?? "949")] ?? "TRY",
    siparisNo, paketNo, belgeNo, durum: metin(alan(ham, "status")), kayitGunu, odemeGunu: gun(alan(ham, "paymentDate")), ham,
  };
}

/** Kaydın satıcı açısından işaretli değeri: gelir artı, gider eksi (ödeme netinde kullanılır). */
export const saticiDegeri = (k: HbKayit) => (k.gelir ? k.tutar : -k.tutar);

/** Kesinti; sipariş tutarı kayıtları (Payment, Return, BNPL) için null. */
export function hbKesintisi(k: HbKayit): NormalizeKesinti | null {
  if (HB_SIPARIS_TIPLERI.has(k.kod) || !k.tutar) return null;
  const tip = hbKayitTipi(k.kod);
  return {
    hariciId: `hb:${k.kimlik}`, tur: tip.ad, sinif: tip.sinif, siparisNo: k.siparisNo,
    aciklama: [k.kod, k.belgeNo ? `Belge ${k.belgeNo}` : null, k.paketNo ? `Paket ${k.paketNo}` : null].filter(Boolean).join(" · ").slice(0, 500),
    tarih: k.kayitGunu, tutar: Math.round((k.gelir ? -k.tutar : k.tutar) * 100) / 100, dovizCinsi: k.doviz,
    odemeNo: k.durum === "Paid" && k.odemeGunu ? hbOdemeNo(k.odemeGunu) : undefined,
    hamVeri: { kaynak: "hepsiburada-muhasebe", ...k.ham },
  };
}

/** Hepsiburada ödeme numarası vermez; ödeme günü dönemin adıdır. */
export const hbOdemeNo = (odemeGunu: string) => `HB-${odemeGunu}`;

/** Ödenmiş kayıtların ödeme günü ve döviz bazında neti (hesaplanmış hakediş tutarı). */
export function hbOdemeDonemleri(kayitlar: HbKayit[]): { odemeNo: string; odemeGunu: string; doviz: DovizKodu; tutar: number; kayitSayisi: number }[] {
  const gruplar = new Map<string, { odemeNo: string; odemeGunu: string; doviz: DovizKodu; tutar: number; kayitSayisi: number }>();
  for (const k of kayitlar) {
    if (k.durum !== "Paid" || !k.odemeGunu) continue;
    const anahtar = `${k.odemeGunu}|${k.doviz}`;
    const g = gruplar.get(anahtar) ?? { odemeNo: hbOdemeNo(k.odemeGunu), odemeGunu: k.odemeGunu, doviz: k.doviz, tutar: 0, kayitSayisi: 0 };
    g.tutar = Math.round((g.tutar + saticiDegeri(k)) * 100) / 100; g.kayitSayisi++;
    gruplar.set(anahtar, g);
  }
  return [...gruplar.values()];
}
