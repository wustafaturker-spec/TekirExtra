/**
 * FTR-41: ticari belgelerin sabit metinleri tek sözlükte. Yeni dil yalnız
 * buraya çeviri eklenerek gelir; kullanıcının yazdığı açıklama ve koşullar
 * çevrilmez. Birimler UBL koduyla (birim-kodu.ts) eşlenip çevrilir.
 */
import { birimKisaAdi, birimTanindiMi, birimUblKodu, type BelgeDili } from "@tekirextra/shared";

const ETIKETLER = {
  // Belge başlıkları
  "baslik.teklif.satis": { tr: "TEKLİF", en: "QUOTATION", de: "ANGEBOT", ar: "عرض سعر", ru: "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ" },
  "baslik.teklif.alis": { tr: "ALIŞ TEKLİFİ", en: "SUPPLIER QUOTATION", de: "LIEFERANTENANGEBOT", ar: "عرض سعر مورد", ru: "ПРЕДЛОЖЕНИЕ ПОСТАВЩИКА" },
  "baslik.siparis.satis": { tr: "SİPARİŞ ONAYI", en: "ORDER CONFIRMATION", de: "AUFTRAGSBESTÄTIGUNG", ar: "تأكيد طلب", ru: "ПОДТВЕРЖДЕНИЕ ЗАКАЗА" },
  "baslik.siparis.alis": { tr: "SATIN ALMA SİPARİŞİ", en: "PURCHASE ORDER", de: "BESTELLUNG", ar: "أمر شراء", ru: "ЗАКАЗ НА ПОСТАВКУ" },
  "baslik.irsaliye.satis": { tr: "SEVK İRSALİYESİ", en: "DELIVERY NOTE", de: "LIEFERSCHEIN", ar: "إشعار تسليم", ru: "ТОВАРНАЯ НАКЛАДНАЯ" },
  "baslik.irsaliye.alis": { tr: "MAL KABUL İRSALİYESİ", en: "GOODS RECEIPT NOTE", de: "WARENEINGANGSSCHEIN", ar: "إشعار استلام بضاعة", ru: "ПРИХОДНАЯ НАКЛАДНАЯ" },
  "baslik.proforma": { tr: "PROFORMA FATURA", en: "PROFORMA INVOICE", de: "PROFORMA-RECHNUNG", ar: "فاتورة مبدئية", ru: "СЧЁТ-ПРОФОРМА" },
  "baslik.fatura": { tr: "FATURA", en: "INVOICE", de: "RECHNUNG", ar: "فاتورة", ru: "СЧЁТ-ФАКТУРА" },
  "baslik.tahsilat": { tr: "TAHSİLAT MAKBUZU", en: "RECEIPT", de: "QUITTUNG", ar: "إيصال استلام", ru: "КВИТАНЦИЯ" },
  "baslik.tediye": { tr: "TEDİYE MAKBUZU", en: "PAYMENT VOUCHER", de: "AUSZAHLUNGSBELEG", ar: "سند صرف", ru: "РАСХОДНЫЙ ОРДЕР" },

  // Üst bilgi
  belgeNo: { tr: "Belge No", en: "Document No", de: "Beleg-Nr.", ar: "رقم المستند", ru: "Номер документа" },
  tarih: { tr: "Tarih", en: "Date", de: "Datum", ar: "التاريخ", ru: "Дата" },
  gecerlilik: { tr: "Geçerlilik", en: "Valid Until", de: "Gültig bis", ar: "صالح حتى", ru: "Действительно до" },
  revizyon: { tr: "Revizyon", en: "Revision", de: "Revision", ar: "المراجعة", ru: "Редакция" },
  matbuNo: { tr: "Matbu İrsaliye No", en: "Printed Note No", de: "Vordruck-Nr.", ar: "رقم النموذج المطبوع", ru: "Номер бланка" },

  // Taraflar
  sayin: { tr: "Sayın", en: "To", de: "An", ar: "إلى السادة", ru: "Кому" },
  tedarikci: { tr: "Tedarikçi", en: "Supplier", de: "Lieferant", ar: "المورد", ru: "Поставщик" },
  bilgiler: { tr: "Belge Bilgileri", en: "Document Details", de: "Belegdetails", ar: "تفاصيل المستند", ru: "Сведения о документе" },
  vkn: { tr: "VKN", en: "Tax ID", de: "Steuer-Nr.", ar: "الرقم الضريبي", ru: "ИНН" },
  vergiDairesi: { tr: "V.D.", en: "Tax Office", de: "Finanzamt", ar: "مكتب الضرائب", ru: "Налоговая" },
  tel: { tr: "Tel", en: "Tel", de: "Tel.", ar: "هاتف", ru: "Тел." },
  ilgili: { tr: "İlgili Kişi", en: "Contact", de: "Ansprechpartner", ar: "جهة الاتصال", ru: "Контактное лицо" },
  talepRef: { tr: "Talep Ref.", en: "Your Inquiry", de: "Ihre Anfrage", ar: "مرجع الطلب", ru: "Ваш запрос" },
  siparisRef: { tr: "Sipariş Ref.", en: "Your Order", de: "Ihre Bestellung", ar: "مرجع أمر الشراء", ru: "Ваш заказ" },
  doviz: { tr: "Para Birimi", en: "Currency", de: "Währung", ar: "العملة", ru: "Валюта" },
  kur: { tr: "Kur", en: "Exchange Rate", de: "Wechselkurs", ar: "سعر الصرف", ru: "Курс" },
  odeme: { tr: "Ödeme Koşulu", en: "Payment Terms", de: "Zahlungsbedingungen", ar: "شروط الدفع", ru: "Условия оплаты" },
  teslimSekli: { tr: "Teslim Şekli", en: "Delivery Terms", de: "Lieferbedingungen", ar: "شروط التسليم", ru: "Условия поставки" },
  teslimSuresi: { tr: "Teslim Süresi", en: "Lead Time", de: "Lieferzeit", ar: "مدة التسليم", ru: "Срок поставки" },

  // Kalem tablosu
  sira: { tr: "#", en: "#", de: "#", ar: "#", ru: "№" },
  kod: { tr: "Kod", en: "Code", de: "Art.-Nr.", ar: "الرمز", ru: "Код" },
  urun: { tr: "Ürün / Hizmet", en: "Description", de: "Bezeichnung", ar: "الوصف", ru: "Наименование" },
  miktar: { tr: "Miktar", en: "Qty", de: "Menge", ar: "الكمية", ru: "Кол-во" },
  birimFiyat: { tr: "Birim Fiyat", en: "Unit Price", de: "Einzelpreis", ar: "سعر الوحدة", ru: "Цена" },
  isk: { tr: "İsk.", en: "Disc.", de: "Rabatt", ar: "الخصم", ru: "Скидка" },
  kdv: { tr: "KDV", en: "VAT", de: "MwSt.", ar: "الضريبة", ru: "НДС" },
  tutar: { tr: "Tutar", en: "Amount", de: "Betrag", ar: "المبلغ", ru: "Сумма" },

  // Toplamlar
  araToplam: { tr: "Ara Toplam", en: "Subtotal", de: "Zwischensumme", ar: "المجموع الفرعي", ru: "Промежуточный итог" },
  iskonto: { tr: "İskonto", en: "Discount", de: "Rabatt", ar: "الخصم", ru: "Скидка" },
  kdvMatrahi: { tr: "KDV Matrahı", en: "Taxable Amount", de: "Nettobetrag", ar: "المبلغ الخاضع للضريبة", ru: "Налоговая база" },
  malHizmetToplami: { tr: "Mal/Hizmet Toplamı", en: "Goods/Services Total", de: "Warenwert", ar: "إجمالي السلع والخدمات", ru: "Стоимость товаров/услуг" },
  hesaplananKdv: { tr: "Hesaplanan KDV", en: "VAT", de: "MwSt.", ar: "ضريبة القيمة المضافة", ru: "НДС" },
  genelToplam: { tr: "Genel Toplam", en: "Grand Total", de: "Gesamtbetrag", ar: "الإجمالي", ru: "Итого к оплате" },
  stopaj: { tr: "stopaj", en: "withholding", de: "Quellensteuer", ar: "استقطاع", ru: "удержание" },
  yalniz: { tr: "Yalnız", en: "Amount in words", de: "In Worten", ar: "المبلغ كتابةً", ru: "Сумма прописью" },

  // Alt bölümler
  kosullar: { tr: "Koşullar ve Notlar", en: "Terms & Notes", de: "Bedingungen und Hinweise", ar: "الشروط والملاحظات", ru: "Условия и примечания" },
  banka: { tr: "Banka Bilgileri", en: "Bank Details", de: "Bankverbindung", ar: "المعلومات المصرفية", ru: "Банковские реквизиты" },
  bankaAd: { tr: "Banka", en: "Bank", de: "Bank", ar: "البنك", ru: "Банк" },
  hesapSahibi: { tr: "Hesap Sahibi", en: "Account Holder", de: "Kontoinhaber", ar: "صاحب الحساب", ru: "Получатель" },
  saygi: { tr: "Saygılarımızla,", en: "Kind regards,", de: "Mit freundlichen Grüßen", ar: "مع أطيب التحيات،", ru: "С уважением," },
  adImzaTarih: { tr: "Ad Soyad · İmza · Tarih", en: "Name · Signature · Date", de: "Name · Unterschrift · Datum", ar: "الاسم · التوقيع · التاريخ", ru: "ФИО · Подпись · Дата" },
  sayfa: { tr: "Sayfa", en: "Page", de: "Seite", ar: "صفحة", ru: "Стр." },
  taslak: { tr: "TASLAK", en: "DRAFT", de: "ENTWURF", ar: "مسودة", ru: "ЧЕРНОВИК" },
  kopya: { tr: "KOPYA", en: "COPY", de: "KOPIE", ar: "نسخة", ru: "КОПИЯ" },
  revizeEdildi: { tr: "Bu sürüm revize edilmiştir, geçerli değildir.", en: "This version has been revised and is no longer valid.", de: "Diese Fassung wurde überarbeitet und ist nicht mehr gültig.", ar: "تمت مراجعة هذه النسخة ولم تعد سارية.", ru: "Эта редакция пересмотрена и недействительна." },
  taslakNo: { tr: "— TASLAK —", en: "— DRAFT —", de: "— ENTWURF —", ar: "— مسودة —", ru: "— ЧЕРНОВИК —" },
  eirsaliyeNo: { tr: "— e-İrsaliye gönderiminde verilir —", en: "— assigned on e-dispatch —", de: "— wird bei e-Versand vergeben —", ar: "— يُمنح عند الإرسال الإلكتروني —", ru: "— присваивается при отправке —" },

  // İmza alanları
  "imza.hazirlayan": { tr: "Hazırlayan", en: "Prepared by", de: "Erstellt von", ar: "أعدّه", ru: "Подготовил" },
  "imza.kase": { tr: "Firma Kaşe / İmza", en: "Company Stamp / Signature", de: "Firmenstempel / Unterschrift", ar: "ختم وتوقيع الشركة", ru: "Печать / подпись компании" },
  "imza.musteriOnayi": { tr: "Müşteri Onayı", en: "Customer Acceptance", de: "Annahme durch den Kunden", ar: "موافقة العميل", ru: "Согласие клиента" },
  "imza.onaylayan": { tr: "Onaylayan", en: "Approved by", de: "Genehmigt von", ar: "اعتمده", ru: "Утвердил" },
  "imza.teslimEden": { tr: "Teslim Eden", en: "Delivered by", de: "Übergeben von", ar: "سلّمه", ru: "Сдал" },
  "imza.teslimAlan": { tr: "Teslim Alan", en: "Received by", de: "Empfangen von", ar: "استلمه", ru: "Принял" },
  "imza.tahsilEden": { tr: "Tahsil Eden", en: "Received by", de: "Empfangen von", ar: "المستلم", ru: "Получил" },
  "imza.odeyen": { tr: "Ödeyen", en: "Paid by", de: "Gezahlt von", ar: "الدافع", ru: "Оплатил" },

  // Ödeme koşulu
  pesin: { tr: "Peşin", en: "Payment in advance", de: "Vorauskasse", ar: "دفع مقدم", ru: "Предоплата" },
  gunVadeli: { tr: "{n} gün vadeli", en: "{n} days net", de: "{n} Tage netto", ar: "آجل {n} يوماً", ru: "Отсрочка {n} дн." },

  // Kapanış cümleleri (FTR-42 metni yoksa)
  "kapanis.teklif": { tr: "Teklifimizi değerlendirmenize sunar, iyi çalışmalar dileriz.", en: "We hope our offer meets your requirements and look forward to your order.", de: "Wir hoffen, dass unser Angebot Ihren Vorstellungen entspricht, und freuen uns auf Ihren Auftrag.", ar: "نأمل أن ينال عرضنا رضاكم، ونتطلع إلى تلقي طلبكم.", ru: "Надеемся, что наше предложение вас заинтересует, и будем рады вашему заказу." },
  "kapanis.siparis": { tr: "Siparişiniz için teşekkür ederiz.", en: "Thank you for your order.", de: "Vielen Dank für Ihren Auftrag.", ar: "نشكركم على طلبكم.", ru: "Благодарим за ваш заказ." },
  "kapanis.proforma": { tr: "Bu belge fatura yerine geçmez.", en: "This document is not a tax invoice.", de: "Dieses Dokument ist keine Rechnung im steuerlichen Sinne.", ar: "هذا المستند ليس فاتورة ضريبية.", ru: "Данный документ не является налоговым счётом-фактурой." },
} as const satisfies Record<string, Record<BelgeDili, string>>;

export type EtiketAnahtari = keyof typeof ETIKETLER;

/** Etiketin verilen dildeki karşılığı; `{n}` gibi yer tutucular doldurulur. */
export function cevir(anahtar: EtiketAnahtari, dil: BelgeDili, degerler?: Record<string, string | number>): string {
  let metin: string = ETIKETLER[anahtar][dil];
  for (const [k, v] of Object.entries(degerler ?? {})) metin = metin.replace(`{${k}}`, String(v));
  return metin;
}

export function etiketVarMi(anahtar: string): anahtar is EtiketAnahtari {
  return anahtar in ETIKETLER;
}

/** UBL birim koduna göre birim adları; listede olmayan birim olduğu gibi basılır. */
const BIRIM_ADLARI: Record<string, Record<BelgeDili, string>> = {
  C62: { tr: "Adet", en: "pcs", de: "Stk.", ar: "قطعة", ru: "шт." },
  PR: { tr: "Çift", en: "pair", de: "Paar", ar: "زوج", ru: "пар." },
  DZN: { tr: "Düzine", en: "doz.", de: "Dutzend", ar: "دزينة", ru: "дюж." },
  SET: { tr: "Set", en: "set", de: "Satz", ar: "طقم", ru: "компл." },
  PK: { tr: "Paket", en: "pack", de: "Pack.", ar: "عبوة", ru: "упак." },
  BX: { tr: "Kutu", en: "box", de: "Karton", ar: "علبة", ru: "кор." },
  CT: { tr: "Koli", en: "carton", de: "Kiste", ar: "كرتونة", ru: "ящ." },
  RO: { tr: "Rulo", en: "roll", de: "Rolle", ar: "لفة", ru: "рул." },
  BG: { tr: "Çuval", en: "bag", de: "Sack", ar: "كيس", ru: "меш." },
  PF: { tr: "Palet", en: "pallet", de: "Palette", ar: "منصة", ru: "палл." },
  BBL: { tr: "Varil", en: "barrel", de: "Fass", ar: "برميل", ru: "бочк." },
  BO: { tr: "Şişe", en: "bottle", de: "Flasche", ar: "زجاجة", ru: "бут." },
  KGM: { tr: "kg", en: "kg", de: "kg", ar: "كغ", ru: "кг" },
  GRM: { tr: "g", en: "g", de: "g", ar: "غ", ru: "г" },
  MGM: { tr: "mg", en: "mg", de: "mg", ar: "ملغ", ru: "мг" },
  TNE: { tr: "Ton", en: "t", de: "t", ar: "طن", ru: "т" },
  LTR: { tr: "lt", en: "l", de: "l", ar: "لتر", ru: "л" },
  MLT: { tr: "ml", en: "ml", de: "ml", ar: "مل", ru: "мл" },
  MTQ: { tr: "m³", en: "m³", de: "m³", ar: "م³", ru: "м³" },
  MTR: { tr: "m", en: "m", de: "m", ar: "م", ru: "м" },
  CMT: { tr: "cm", en: "cm", de: "cm", ar: "سم", ru: "см" },
  MMT: { tr: "mm", en: "mm", de: "mm", ar: "مم", ru: "мм" },
  KMT: { tr: "km", en: "km", de: "km", ar: "كم", ru: "км" },
  MTK: { tr: "m²", en: "m²", de: "m²", ar: "م²", ru: "м²" },
  HUR: { tr: "Saat", en: "hrs", de: "Std.", ar: "ساعة", ru: "ч" },
  MIN: { tr: "Dakika", en: "min", de: "Min.", ar: "دقيقة", ru: "мин" },
  DAY: { tr: "Gün", en: "days", de: "Tage", ar: "يوم", ru: "дн." },
  WEE: { tr: "Hafta", en: "weeks", de: "Wochen", ar: "أسبوع", ru: "нед." },
  MON: { tr: "Ay", en: "months", de: "Monate", ar: "شهر", ru: "мес." },
  ANN: { tr: "Yıl", en: "years", de: "Jahre", ar: "سنة", ru: "г." },
  KWH: { tr: "kWh", en: "kWh", de: "kWh", ar: "ك.و.س", ru: "кВт·ч" },
  KWT: { tr: "kW", en: "kW", de: "kW", ar: "ك.و", ru: "кВт" },
  MWH: { tr: "MWh", en: "MWh", de: "MWh", ar: "م.و.س", ru: "МВт·ч" },
};

/** Satırdaki birimin belge dilindeki adı; tanınmayan birim kartta yazıldığı gibi kalır. */
export function birimAdi(birim: string, dil: BelgeDili): string {
  // birimUblKodu tanınmayanı "adet" sayar; yanlış çeviri basmamak için önce tanınıyor mu bakılır.
  const ad = birimTanindiMi(birim) ? BIRIM_ADLARI[birimUblKodu(birim)] : undefined;
  return ad ? ad[dil] : birimKisaAdi(birim);
}

/** Incoterms kodu tüm dillerde aynıdır; Türkçede açıklamasıyla, diğerlerinde resmî İngilizce adıyla. */
const INCOTERMS_EN: Record<string, string> = {
  EXW: "Ex Works", FCA: "Free Carrier", FAS: "Free Alongside Ship", FOB: "Free On Board",
  CFR: "Cost and Freight", CIF: "Cost, Insurance and Freight", CPT: "Carriage Paid To",
  CIP: "Carriage and Insurance Paid To", DAP: "Delivered At Place", DPU: "Delivered at Place Unloaded",
  DDP: "Delivered Duty Paid",
};

export function teslimSekliMetni(kod: string, dil: BelgeDili, trAd: string | undefined): string {
  if (dil === "tr") return trAd ?? kod;
  return INCOTERMS_EN[kod] ? `${kod} — ${INCOTERMS_EN[kod]} (Incoterms® 2020)` : kod;
}

export function odemeMetni(vadeGun: number, dil: BelgeDili): string {
  return vadeGun === 0 ? cevir("pesin", dil) : cevir("gunVadeli", dil, { n: vadeGun });
}
