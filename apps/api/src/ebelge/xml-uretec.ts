import { Fatura, FaturaSatir, CariHesap } from "@prisma/client";
import { senaryoUblKodu, tevkifatKoduBul } from "@tekirextra/shared";

/** UBL içine gömülen başlangıç fatura görünümü; kurumsal şablonla değiştirilebilir. */
const FATURA_XSLT = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/"><html><head><meta charset="UTF-8"/><title>Fatura</title></head><body style="font-family:Arial,sans-serif"><h1>Fatura <xsl:value-of select="//*[local-name()='Invoice']/*[local-name()='ID']"/></h1><p>Tarih: <xsl:value-of select="//*[local-name()='IssueDate']"/></p><p>Toplam: <strong><xsl:value-of select="//*[local-name()='PayableAmount']"/> <xsl:value-of select="//*[local-name()='DocumentCurrencyCode']"/></strong></p></body></html></xsl:template>
</xsl:stylesheet>`;

export function faturaUblUret(
  fatura: Fatura & {
    satirlar: (FaturaSatir & { stok: { kod: string; ad: string } })[];
    cari: CariHesap;
  },
  supplier: { unvan: string; vkn: string; vergiDairesi?: string; adres?: string },
  secenekler: { tur?: "efatura" | "earsiv" } = {},
): string {
  // e-Arşiv, e-Fatura'dan üç noktada ayrılır: profil `EARSIVFATURA`, alıcı
  // etiketi yoktur ve gönderim şekli UBL içinde bildirilir.
  const earsiv = secenekler.tur === "earsiv";
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
   * Gerçek kişi alıcı. UBL-TR şematronu `schemeID="TCKN"` gördüğünde `cac:Person`
   * arar; ünvanı `cac:PartyName` içinde bırakmak e-Arşiv gönderimini reddettirir
   * (NES, 2026-09-10). Kart üzerinde ad/soyad ayrı tutulmadığı için son kelime
   * soyad, kalanı ad sayılır.
   */
  const aliciTckn = fatura.cari.vknTckn?.length === 11;
  const adParcalari = (fatura.cari.unvan ?? "").trim().split(/\s+/).filter(Boolean);
  const aliciSoyad = adParcalari.length > 1 ? adParcalari[adParcalari.length - 1] : adParcalari[0] ?? "";
  const aliciAd = adParcalari.length > 1 ? adParcalari.slice(0, -1).join(" ") : adParcalari[0] ?? "";

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
  <cbc:ProfileID>${earsiv ? "EARSIVFATURA" : fatura.efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}</cbc:ProfileID>
  <cbc:ID>${no}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
  <cbc:IssueTime>${saatStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${senaryoUblKodu(fatura.senaryo)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${fatura.dovizCinsi}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${fatura.satirlar.length}</cbc:LineCountNumeric>

${earsiv ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>ELEKTRONIK</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>SEND_TYPE</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>` : ""}
  <cac:AdditionalDocumentReference>
    <cbc:ID>${uuid}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>XSLT</cbc:DocumentTypeCode>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject characterSetCode="UTF-8" encodingCode="Base64" filename="${escape(no)}.xslt" mimeCode="application/xml">${Buffer.from(FATURA_XSLT, "utf8").toString("base64")}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  
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
        <cbc:ID schemeID="${aliciTckn ? "TCKN" : "VKN"}">${fatura.cari.vknTckn}</cbc:ID>
      </cac:PartyIdentification>
${aliciTckn ? "" : `      <cac:PartyName>
        <cbc:Name>${escape(fatura.cari.unvan)}</cbc:Name>
      </cac:PartyName>`}
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
${aliciTckn ? `      <cac:Person>
        <cbc:FirstName>${escape(aliciAd)}</cbc:FirstName>
        <cbc:FamilyName>${escape(aliciSoyad)}</cbc:FamilyName>
      </cac:Person>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
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
    <cbc:AllowanceTotalAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamSatirIskontosu.toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${fatura.satirlar
    .map(
      (s, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">${s.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${s.iskontoTutari.toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${s.kdvTutari.toFixed(2)}</cbc:TaxAmount>
        <cbc:Percent>${s.kdvOrani.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          ${s.gibIstisnaKodu ? `<cbc:TaxExemptionReasonCode>${escape(s.gibIstisnaKodu)}</cbc:TaxExemptionReasonCode>` : ""}
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
      </cac:SellersItemIdentification>
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
