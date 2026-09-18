import { Fatura, FaturaSatir, CariHesap } from "@prisma/client";
import {
  IHRACAT_ALICI_VKN,
  IHRACAT_FATURA_TIPI,
  IHRACAT_PROFILI,
  IHRACAT_VERGI_PARA_BIRIMI,
  birimUblKodu,
  gtipNormalize,
  ihracatIstisnaKodu,
  ihracatIstisnaKoduMu,
  senaryoUblKodu,
  tevkifatKoduBul,
  ublAdresi,
  ulkeKoduCoz,
} from "@tekirextra/shared";
import { adSoyadCoz } from "../cari/ad-soyad";

/*
 * Giden belgeye görünüm (XSLT) gömülmez — karar 2026-09-17, EBLG-31 iptal.
 * Portal denemesi gösterdi ki entegratör belgeyi kendi tasarımıyla basıyor ve
 * gömülü görünümü kullanmıyor; her faturaya ~80 KB ölü yük ekliyorduk. Kendi
 * çıktılarımızın görünümü `belge-temasi.ts`'ten gelmeyi sürdürür (FTR-22…24).
 * Gelen belgelerde gönderenin gömülü görünümünü okumaya devam ederiz (EBLG-28).
 */

export interface IhracatUblBilgisi {
  /** Alıcının ISO 3166-1 alpha-2 ülke kodu; TR olamaz. */
  ulkeKodu: string;
  /** Fiili ihracat tarihi. */
  teslimTarihi?: Date | null;
  /** Incoterms kodu (EXW, FOB, CIF…). */
  teslimSarti?: string | null;
  /** UN/ECE Rec. 19 taşıma şekli kodu. */
  tasimaSekli?: string | null;
  /** Gümrük beyanname numarası; gönderimden önce biliniyorsa belgeye yazılır. */
  beyannameNo?: string | null;
}

export function faturaUblUret(
  fatura: Fatura & {
    satirlar: (FaturaSatir & {
      stok: { kod: string; ad: string; tip?: string | null; gtipKodu?: string | null; mensei?: string | null };
    })[];
    /**
     * EBLG-55: alıcı adresi karttan gelir. Adresler okunmadan üretilen belgede
     * adres "-" gider; sabit bir şehir yazmaktansa eksikliği görünsün.
     */
    cari: CariHesap & { adresler?: { tip: string; adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string | null }[] };
  },
  supplier: { unvan: string; vkn: string; vergiDairesi?: string; adres?: string },
  secenekler: { tur?: "efatura" | "earsiv"; ihracat?: IhracatUblBilgisi } = {},
): string {
  // e-Arşiv, e-Fatura'dan üç noktada ayrılır: profil `EARSIVFATURA`, alıcı
  // etiketi yoktur ve gönderim şekli UBL içinde bildirilir.
  const earsiv = secenekler.tur === "earsiv";
  /*
   * İhracat, e-Fatura kanalının bir senaryosudur: profil `IHRACAT`, alıcı
   * kimliği yurt dışı alıcı sabiti, KDV istisnalı ve gümrük alanları dolu.
   * Karar sihirbazda verilmez, alıcının ülkesinden gelir (tasarım belgesi §3.1).
   */
  const ihracat = secenekler.ihracat;
  /**
   * Alıcı adresi (EBLG-55). Belgede tek bir adres görünür; hangisi olduğu
   * `belgeAdresiSec` kuralına göre seçilir ve ihracat kanalı kararı da aynı
   * adresin ülkesinden gelir.
   */
  const aliciAdres = ublAdresi(fatura.cari.adresler);
  // ISO Tarihleri
  const tarihStr = fatura.tarih.toISOString().slice(0, 10);
  const saatStr = "12:00:00";

  // XML Karakter kaçırma yardımcısı
  const escape = (str?: string | null) => {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  const uuid = fatura.id;
  const no = fatura.no || "TASLAK";

  /**
   * Satırın KDV istisna kodu. İhracatta kod kullanıcıdan değil satırın
   * malından/hizmetinden türer (301/302); kullanıcı ihracata uyan başka bir tam
   * istisna kodu seçtiyse (ör. 316 serbest bölge fason) o korunur.
   */
  const satirIstisnaKodu = (satir: { gibIstisnaKodu: string | null; stok: { tip?: string | null } }): string | null => {
    if (!ihracat) return satir.gibIstisnaKodu;
    return ihracatIstisnaKoduMu(satir.gibIstisnaKodu) ? satir.gibIstisnaKodu : ihracatIstisnaKodu(satir.stok.tip);
  };

  /**
   * Gerçek kişi alıcı. UBL-TR şematronu `schemeID="TCKN"` gördüğünde `cac:Person`
   * arar; ünvanı `cac:PartyName` içinde bırakmak e-Arşiv gönderimini reddettirir
   * (NES, 2026-09-10). Ad ve soyad kartta ayrı tutulur (CARI-21); boşsa
   * unvandan tahmin edilir.
   */
  const aliciTckn = fatura.cari.vknTckn?.length === 11;
  const { ad: aliciAd, soyad: aliciSoyad } = adSoyadCoz(fatura.cari);

  /**
   * Tevkifat, fatura düzeyinde `WithholdingTaxTotal` olarak bildirilir; vergi
   * türü kodu satırdaki GİB tevkifat kodudur (FTR-18). Aynı kodlu satırlar tek
   * blokta toplanır, çünkü kod başına bir alt toplam beklenir.
   */
  const tevkifatGruplari = new Map<string, { tutar: number; oran: number }>();
  for (const satir of fatura.satirlar) {
    if (!satir.tevkifatKodu || Number(satir.tevkifatTutari) === 0) continue;
    const mevcut = tevkifatGruplari.get(satir.tevkifatKodu) ?? { tutar: 0, oran: 0 };
    mevcut.tutar += Number(satir.tevkifatTutari);
    // Oran koddan gelir; pay/payda saklı türetilmiş değerlerdir.
    if (satir.tevkifatPay && satir.tevkifatPayda) mevcut.oran = (satir.tevkifatPay / satir.tevkifatPayda) * 100;
    tevkifatGruplari.set(satir.tevkifatKodu, mevcut);
  }
  const tevkifatBlogu = [...tevkifatGruplari.entries()]
    .filter(([kod]) => tevkifatKoduBul(kod))
    .map(([kod, deger]) => `  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
      <cbc:Percent>${deger.oran.toFixed(2)}</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:TaxTypeCode>${kod}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${ihracat ? IHRACAT_PROFILI : earsiv ? "EARSIVFATURA" : fatura.efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}</cbc:ProfileID>
  <cbc:ID>${no}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
  <cbc:IssueTime>${saatStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${ihracat ? IHRACAT_FATURA_TIPI : senaryoUblKodu(fatura.senaryo)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${fatura.dovizCinsi}</cbc:DocumentCurrencyCode>${ihracat ? `
  <cbc:TaxCurrencyCode>${IHRACAT_VERGI_PARA_BIRIMI}</cbc:TaxCurrencyCode>${fatura.dovizCinsi === IHRACAT_VERGI_PARA_BIRIMI ? "" : `
  <cbc:PricingCurrencyCode>${fatura.dovizCinsi}</cbc:PricingCurrencyCode>`}` : ""}
  <cbc:LineCountNumeric>${fatura.satirlar.length}</cbc:LineCountNumeric>

${earsiv ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>${fatura.earsivGonderimSekli === "kagit" ? "KAGIT" : "ELEKTRONIK"}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>SEND_TYPE</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>` : ""}${ihracat?.beyannameNo ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>${escape(ihracat.beyannameNo)}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentType>CUST_INV</cbc:DocumentType>
  </cac:AdditionalDocumentReference>` : ""}
  
  <cac:Signature>
    <cbc:ID schemeID="VKN_TCKN">${supplier.vkn}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#Signature</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${escape(supplier.vergiDairesi || "Marmara V.D.")}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${ihracat ? "VKN" : aliciTckn ? "TCKN" : "VKN"}">${ihracat ? IHRACAT_ALICI_VKN : fatura.cari.vknTckn}</cbc:ID>
      </cac:PartyIdentification>
${aliciTckn && !ihracat ? "" : `      <cac:PartyName>
        <cbc:Name>${escape(fatura.cari.unvan)}</cbc:Name>
      </cac:PartyName>`}
      <cac:PostalAddress>${aliciAdres.adres ? `
        <cbc:StreetName>${escape(aliciAdres.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(aliciAdres.ilce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(aliciAdres.il)}</cbc:CityName>${aliciAdres.postaKodu ? `
        <cbc:PostalZone>${escape(aliciAdres.postaKodu)}</cbc:PostalZone>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${aliciAdres.ulkeKodu}</cbc:IdentificationCode>${aliciAdres.ulkeAdi ? `
          <cbc:Name>${escape(aliciAdres.ulkeAdi)}</cbc:Name>` : ""}
        </cac:Country>
      </cac:PostalAddress>
${aliciTckn && !ihracat ? `      <cac:Person>
        <cbc:FirstName>${escape(aliciAd)}</cbc:FirstName>
        <cbc:FamilyName>${escape(aliciSoyad)}</cbc:FamilyName>
      </cac:Person>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>
${ihracat ? `
  <cac:Delivery>${ihracat.teslimTarihi ? `
    <cbc:ActualDeliveryDate>${ihracat.teslimTarihi.toISOString().slice(0, 10)}</cbc:ActualDeliveryDate>` : ""}${ihracat.tasimaSekli ? `
    <cac:Shipment>
      <cbc:ID>1</cbc:ID>
      <cac:ShipmentStage>
        <cbc:TransportModeCode>${escape(ihracat.tasimaSekli)}</cbc:TransportModeCode>
      </cac:ShipmentStage>
    </cac:Shipment>` : ""}
  </cac:Delivery>${ihracat.teslimSarti ? `
  <cac:DeliveryTerms>
    <cbc:ID schemeID="INCOTERMS">${escape(ihracat.teslimSarti)}</cbc:ID>
  </cac:DeliveryTerms>` : ""}
` : ""}
${ihracat && fatura.dovizCinsi !== IHRACAT_VERGI_PARA_BIRIMI ? `  <cac:TaxExchangeRate>
    <cbc:SourceCurrencyCode>${fatura.dovizCinsi}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>${IHRACAT_VERGI_PARA_BIRIMI}</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${Number(fatura.kur).toFixed(6)}</cbc:CalculationRate>
    <cbc:Date>${tarihStr}</cbc:Date>
  </cac:TaxExchangeRate>
` : ""}  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamKdv.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamMatrah.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamKdv.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
${tevkifatBlogu}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamBrut.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamMatrah.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${fatura.dovizCinsi}">${kurusTopla(fatura.toplamSatirIskontosu, fatura.genelIskontoToplam)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${fatura.satirlar
    .map(
      (s, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${birimUblKodu(s.birim)}">${s.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      ${Number(s.iskontoOrani ?? 0) > 0 ? `<cbc:MultiplierFactorNumeric>${(Number(s.iskontoOrani) / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>` : ""}
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${s.iskontoTutari.toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>${Number(s.genelIskontoPayi ?? 0) > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Genel iskonto payı</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${Number(s.genelIskontoPayi).toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>` : ""}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
        <cbc:Percent>${s.kdvOrani.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          ${satirIstisnaKodu(s) ? `<cbc:TaxExemptionReasonCode>${escape(satirIstisnaKodu(s))}</cbc:TaxExemptionReasonCode>` : ""}
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escape(s.stok.ad)}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>${escape(s.stok.kod)}</cbc:ID>
      </cac:SellersItemIdentification>${ihracat && ulkeKoduCoz(s.stok.mensei) ? `
      <cac:OriginCountry>
        <cbc:IdentificationCode>${ulkeKoduCoz(s.stok.mensei)}</cbc:IdentificationCode>
      </cac:OriginCountry>` : ""}${ihracat && gtipNormalize(s.stok.gtipKodu) ? `
      <cac:CommodityClassification>
        <cbc:ItemClassificationCode listID="GTIP">${gtipNormalize(s.stok.gtipKodu)}</cbc:ItemClassificationCode>
      </cac:CommodityClassification>` : ""}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${fatura.dovizCinsi}">${s.birimFiyat.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
  `,
    )
    .join("")}
</Invoice>`;
}

/**
 * EBLG-16 sonrası düzeltme: numarayı sağlayıcı attığında UBL'e yalnız seri
 * öneki yazılmış olur. Arşivlenen belge, düzenlenen belgenin kendisidir; bu
 * yüzden sağlayıcıdan dönen numara `cbc:ID` alanına geri yazılır. Yoksa
 * arşivdeki belge numarasız kalır ve ondan üretilen görünüm "SNC" der.
 *
 * Fatura numarası, `cbc:ProfileID`'yi izleyen ilk `cbc:ID`'dir — belgede
 * onlarca `cbc:ID` bulunduğu için değişiklik bu çıpaya bağlanır.
 */
export function belgeNoyuUbleYaz(xml: string, belgeNo: string): string {
  const desen = /(<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>)([^<]*)(<\/cbc:ID>)/;
  if (!desen.test(xml)) return xml;
  return xml.replace(desen, (_tam, bas: string, _eski: string, son: string) => `${bas}${escapeXml(belgeNo)}${son}`);
}

/** Tutarları kuruşta toplar; ondalıklı toplama `0.1 + 0.2` kaymasına düşmesin. */
function kurusTopla(...tutarlar: (number | { toString(): string } | null | undefined)[]): string {
  const kurus = tutarlar.reduce<number>((t, v) => t + Math.round(Number(v ?? 0) * 100), 0);
  return (kurus / 100).toFixed(2);
}

function escapeXml(deger: string): string {
  return deger
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
