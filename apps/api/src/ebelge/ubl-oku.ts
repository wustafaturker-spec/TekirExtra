/**
 * UBL-TR 1.2 gelen fatura okuyucu (EBLG-05).
 *
 * `xml-uretec.ts` giden tarafın karşılığıdır; bu dosya entegratörden gelen
 * belgeyi ayrıştırıp onay ekranının ve taslak alış faturasının ihtiyaç duyduğu
 * alanlara indirger. Ayrıştırma **tolere edicidir**: eksik/boş alanlar hataya
 * değil, varsayılana düşer — gerçek entegratör belgeleri şemadan sapabiliyor.
 */
import { XMLParser } from "fast-xml-parser";

export interface UblSatir {
  siraNo: number;
  ad: string;
  /** Satıcının kendi ürün kodu (SellersItemIdentification). */
  saticiUrunKodu?: string;
  /** Bizim (alıcının) ürün kodumuz — satıcı biliyorsa yazar. */
  aliciUrunKodu?: string;
  ureticiUrunKodu?: string;
  /** GTIN/barkod (StandardItemIdentification). */
  barkod?: string;
  miktar: number;
  birim: string;
  birimFiyat: number;
  iskontoOrani: number;
  iskontoTutari: number;
  kdvOrani: number;
  kdvTutari: number;
  /** Satır net tutarı (LineExtensionAmount) — iskonto düşülmüş, KDV hariç. */
  matrah: number;
}

export interface UblToplamlar {
  satirToplami: number;
  iskontoToplami: number;
  matrah: number;
  kdv: number;
  genelToplam: number;
}

export interface UblFatura {
  uuid: string;
  belgeNo: string;
  /** TEMELFATURA | TICARIFATURA | … — kabul/ret yalnızca TICARIFATURA'da geçerli (EBLG-06). */
  profilId: string;
  faturaTipKodu: string;
  tarih: string;
  dovizCinsi: string;
  gonderen: { vknTckn: string; unvan: string; vergiDairesi?: string };
  alici: { vknTckn: string; unvan: string };
  toplamlar: UblToplamlar;
  satirlar: UblSatir[];
}

/** UN/ECE Rec 20 birim kodları → sistemdeki birim adları. */
const BIRIM_KODLARI: Record<string, string> = {
  C62: "adet",
  NIU: "adet",
  PCE: "adet",
  KGM: "kg",
  GRM: "gram",
  TNE: "ton",
  LTR: "litre",
  MLT: "ml",
  MTR: "metre",
  MTK: "m2",
  MTQ: "m3",
  CMT: "cm",
  MMT: "mm",
  PA: "paket",
  PK: "paket",
  BX: "kutu",
  CT: "koli",
  SET: "set",
  PR: "çift",
  DAY: "gün",
  HUR: "saat",
  MON: "ay",
  ANN: "yıl",
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type Dugum = Record<string, unknown>;

function nesne(deger: unknown): Dugum | undefined {
  return deger !== null && typeof deger === "object" && !Array.isArray(deger)
    ? (deger as Dugum)
    : undefined;
}

/** Tek düğüm de liste de gelebilir (LineCountNumeric 1 ise dizi olmaz). */
function dizi(deger: unknown): Dugum[] {
  if (deger === undefined || deger === null) return [];
  if (Array.isArray(deger)) return deger.filter((d) => nesne(d) !== undefined) as Dugum[];
  const n = nesne(deger);
  return n ? [n] : [];
}

/** Düğümün metin değeri: düz string ya da öznitelikli düğümün `#text`i. */
function metin(deger: unknown): string {
  if (deger === undefined || deger === null) return "";
  if (typeof deger === "string") return deger.trim();
  if (typeof deger === "number") return String(deger);
  const n = nesne(deger);
  if (n && "#text" in n) return String(n["#text"] ?? "").trim();
  return "";
}

function sayi(deger: unknown): number {
  const ham = metin(deger).replace(",", ".");
  if (!ham) return 0;
  const d = Number(ham);
  return Number.isFinite(d) ? d : 0;
}

function oznitelik(deger: unknown, ad: string): string {
  const n = nesne(deger);
  return n ? String(n[`@_${ad}`] ?? "").trim() : "";
}

/** Yol boyunca ilk düğümü izler; ara adımda dizi varsa ilk elemanı alır. */
function yol(kok: unknown, ...adlar: string[]): unknown {
  let mevcut: unknown = kok;
  for (const ad of adlar) {
    if (Array.isArray(mevcut)) mevcut = mevcut[0];
    const n = nesne(mevcut);
    if (!n) return undefined;
    mevcut = n[ad];
  }
  return mevcut;
}

/**
 * `cac:PartyIdentification` birden çok olabilir (VKN, MERSISNO, TICARETSICILNO…).
 * schemeID'si VKN/TCKN olanı seçer, yoksa ilkine düşer.
 */
function vknBul(party: unknown): string {
  const kimlikler = dizi(yol(party, "PartyIdentification"));
  for (const k of kimlikler) {
    const scheme = oznitelik(k.ID, "schemeID").toUpperCase();
    if (scheme === "VKN" || scheme === "TCKN") return metin(k.ID);
  }
  return kimlikler.length > 0 ? metin(kimlikler[0].ID) : "";
}

function partyOku(party: unknown): { vknTckn: string; unvan: string; vergiDairesi?: string } {
  const vknTckn = vknBul(party);
  // Tüzel kişide PartyName, gerçek kişide Person/FirstName+FamilyName dolu olur.
  const unvan =
    metin(yol(party, "PartyName", "Name")) ||
    [metin(yol(party, "Person", "FirstName")), metin(yol(party, "Person", "FamilyName"))]
      .filter(Boolean)
      .join(" ");
  const vergiDairesi = metin(yol(party, "PartyTaxScheme", "TaxScheme", "Name"));
  return { vknTckn, unvan, vergiDairesi: vergiDairesi || undefined };
}

/** TaxSubtotal içindeki KDV oranı: TaxSubtotal/Percent ya da TaxCategory/Percent. */
function kdvOraniOku(taxSubtotal: Dugum | undefined): number {
  if (!taxSubtotal) return 0;
  const dogrudan = sayi(taxSubtotal.Percent);
  if (dogrudan > 0) return dogrudan;
  return sayi(yol(taxSubtotal, "TaxCategory", "Percent"));
}

/** KDV alt toplamlarından yalnız KDV (0015) olanı seçer; kod yoksa ilkini alır. */
function kdvAltToplam(taxTotal: unknown): Dugum | undefined {
  const altlar = dizi(yol(taxTotal, "TaxSubtotal"));
  const kdv = altlar.find((a) => {
    const kod = metin(yol(a, "TaxCategory", "TaxScheme", "TaxTypeCode"));
    return kod === "0015";
  });
  return kdv ?? altlar[0];
}

function satirOku(satir: Dugum, sira: number): UblSatir {
  const miktarDugum = satir.InvoicedQuantity;
  const miktar = sayi(miktarDugum);
  const birimKodu = oznitelik(miktarDugum, "unitCode").toUpperCase();
  const matrah = sayi(satir.LineExtensionAmount);

  // Fiyat: Price/PriceAmount birim fiyattır. Yoksa matrahtan geri hesaplanır.
  let birimFiyat = sayi(yol(satir, "Price", "PriceAmount"));
  if (birimFiyat === 0 && miktar > 0) birimFiyat = matrah / miktar;

  // İskonto: ChargeIndicator=false olan AllowanceCharge kayıtları toplanır.
  let iskontoTutari = 0;
  let carpan = 0;
  for (const ac of dizi(satir.AllowanceCharge)) {
    if (metin(ac.ChargeIndicator).toLowerCase() === "true") continue;
    iskontoTutari += sayi(ac.Amount);
    if (carpan === 0) carpan = sayi(ac.MultiplierFactorNumeric);
  }

  const brut = miktar * birimFiyat;
  const iskontoOrani =
    carpan > 0 ? carpan * 100 : brut > 0 ? (iskontoTutari / brut) * 100 : 0;

  const altToplam = kdvAltToplam(satir.TaxTotal);
  const kdvTutari = sayi(yol(satir, "TaxTotal", "TaxAmount")) || sayi(altToplam?.TaxAmount);
  let kdvOrani = kdvOraniOku(altToplam);
  // Oran yazılmamışsa tutardan çıkar (yaygın oranlara yuvarlanmaz — ham değer).
  if (kdvOrani === 0 && matrah > 0 && kdvTutari > 0) {
    kdvOrani = Math.round((kdvTutari / matrah) * 1000) / 10;
  }

  const item = nesne(satir.Item) ?? {};

  return {
    siraNo: sayi(satir.ID) || sira,
    ad: metin(item.Name) || metin(item.Description) || `Kalem ${sira}`,
    saticiUrunKodu: metin(yol(item, "SellersItemIdentification", "ID")) || undefined,
    aliciUrunKodu: metin(yol(item, "BuyersItemIdentification", "ID")) || undefined,
    ureticiUrunKodu:
      metin(yol(item, "ManufacturersItemIdentification", "ID")) || undefined,
    barkod: metin(yol(item, "StandardItemIdentification", "ID")) || undefined,
    miktar,
    birim: BIRIM_KODLARI[birimKodu] ?? (birimKodu ? birimKodu.toLowerCase() : "adet"),
    birimFiyat,
    iskontoOrani: Math.round(iskontoOrani * 100) / 100,
    iskontoTutari,
    kdvOrani,
    kdvTutari,
    matrah,
  };
}

export class UblOkumaHatasi extends Error {}

/**
 * UBL-TR fatura XML'ini ayrıştırır. Kök `Invoice` bulunamazsa
 * {@link UblOkumaHatasi} fırlatır; diğer tüm eksiklikler sessizce varsayılana
 * düşer, çünkü onay ekranı kullanıcıya eksikleri tamamlatır.
 */
export function faturaUblOku(xml: string): UblFatura {
  let kok: Dugum | undefined;
  try {
    kok = nesne(parser.parse(xml));
  } catch (hata) {
    throw new UblOkumaHatasi(
      `XML ayrıştırılamadı: ${hata instanceof Error ? hata.message : "bilinmeyen hata"}`,
    );
  }

  const fatura = nesne(kok?.Invoice);
  if (!fatura) throw new UblOkumaHatasi("Belgede UBL Invoice kökü bulunamadı");

  const satirlar = dizi(fatura.InvoiceLine).map((s, i) => satirOku(s, i + 1));

  const parasal = nesne(fatura.LegalMonetaryTotal);
  const kdvBasligi = kdvAltToplam(fatura.TaxTotal);
  const kdvToplam =
    sayi(yol(fatura, "TaxTotal", "TaxAmount")) || sayi(kdvBasligi?.TaxAmount);

  const satirToplami = sayi(parasal?.LineExtensionAmount);
  const matrah = sayi(parasal?.TaxExclusiveAmount) || satirToplami;
  const genelToplam = sayi(parasal?.PayableAmount) || sayi(parasal?.TaxInclusiveAmount);

  return {
    uuid: metin(fatura.UUID),
    belgeNo: metin(fatura.ID),
    profilId: metin(fatura.ProfileID) || "TEMELFATURA",
    faturaTipKodu: metin(fatura.InvoiceTypeCode) || "SATIS",
    tarih: metin(fatura.IssueDate),
    dovizCinsi: metin(fatura.DocumentCurrencyCode) || "TRY",
    gonderen: partyOku(yol(fatura, "AccountingSupplierParty", "Party")),
    alici: partyOku(yol(fatura, "AccountingCustomerParty", "Party")),
    toplamlar: {
      satirToplami,
      iskontoToplami: sayi(parasal?.AllowanceTotalAmount),
      matrah,
      kdv: kdvToplam,
      genelToplam: genelToplam || matrah + kdvToplam,
    },
    satirlar,
  };
}
