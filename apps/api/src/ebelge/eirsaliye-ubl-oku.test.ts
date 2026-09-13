import { describe, expect, it } from "vitest";
import { EIRSALIYE_YEDEK_GORUNUM_NOTU, eirsaliyeYedekPdfHtml } from "./eirsaliye-pdf";
import { IrsaliyeUblOkumaHatasi, irsaliyeUblOku } from "./eirsaliye-ubl-oku";
import { gomuluXsltCikar } from "./ubl-gorunum";

const XSLT = Buffer.from('<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>').toString("base64");

/** Gerçek gelen belgelerin yapısı: teslimat ve sevk Shipment/Delivery altında. */
const IRSALIYE = (ek = "") => `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>
  <cbc:ID>TYH2026000000016</cbc:ID>
  <cbc:UUID>f290cda1-acdb-4171-8bd6-c426a75cf8ba</cbc:UUID>
  <cbc:IssueDate>2026-09-10</cbc:IssueDate>
  <cbc:IssueTime>14:05:00</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>
  <cbc:Note>Kırılacak eşya &amp; dikkat</cbc:Note>
  ${ek}
  <cac:DespatchSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0999</cbc:ID></cac:PartyIdentification>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">4620553774</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>HIZLI BİLİŞİM A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Atatürk Cad.</cbc:StreetName><cbc:CitySubdivisionName>Kadıköy</cbc:CitySubdivisionName><cbc:CityName>İstanbul</cbc:CityName></cac:PostalAddress>
  </cac:Party></cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567801</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>ErpClub Test Kurum 01</cbc:Name></cac:PartyName>
  </cac:Party></cac:DeliveryCustomerParty>
  <cac:Shipment>
    <cbc:ID>1</cbc:ID>
    <cac:Delivery>
      <cac:DeliveryAddress><cbc:StreetName>OSB 3. Cadde</cbc:StreetName><cbc:BuildingNumber>7</cbc:BuildingNumber><cbc:CityName>Denizli</cbc:CityName></cac:DeliveryAddress>
      <cac:CarrierParty>
        <cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name>Hızlı Nakliyat</cbc:Name></cac:PartyName>
      </cac:CarrierParty>
      <cac:Despatch><cbc:ActualDespatchDate>2026-09-11</cbc:ActualDespatchDate><cbc:ActualDespatchTime>07:45:00</cbc:ActualDespatchTime></cac:Despatch>
    </cac:Delivery>
    <cac:ShipmentStage>
      <cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID schemeID="PLAKA">34ABC123</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>
      <cac:DriverPerson><cbc:FirstName>Mehmet</cbc:FirstName><cbc:FamilyName>Öztürk</cbc:FamilyName></cac:DriverPerson>
    </cac:ShipmentStage>
    <cac:TransportHandlingUnit><cac:TransportEquipment><cbc:ID schemeID="DORSEPLAKA">34DR4088</cbc:ID></cac:TransportEquipment></cac:TransportHandlingUnit>
  </cac:Shipment>
  <cac:DespatchLine>
    <cbc:ID>1</cbc:ID>
    <cbc:DeliveredQuantity unitCode="C62">5</cbc:DeliveredQuantity>
    <cac:Item><cbc:Name>Kablo &lt;3m&gt;</cbc:Name><cac:SellersItemIdentification><cbc:ID>KBL-3</cbc:ID></cac:SellersItemIdentification></cac:Item>
  </cac:DespatchLine>
  <cac:DespatchLine>
    <cbc:ID>2</cbc:ID>
    <cbc:DeliveredQuantity unitCode="KGM">12.5</cbc:DeliveredQuantity>
    <cac:Item><cbc:Description>Somun</cbc:Description></cac:Item>
  </cac:DespatchLine>
</DespatchAdvice>`;

describe("irsaliyeUblOku (EBLG-33)", () => {
  it("gönderen, alıcı, kimlik ve taşıma alanlarını gerçek belge yapısından okur", () => {
    const r = irsaliyeUblOku(IRSALIYE());

    expect(r).toMatchObject({
      uuid: "f290cda1-acdb-4171-8bd6-c426a75cf8ba",
      belgeNo: "TYH2026000000016",
      tarih: "2026-09-10",
      saat: "14:05:00",
      profilId: "TEMELIRSALIYE",
      tipKodu: "SEVK",
      gonderen: { vknTckn: "4620553774", unvan: "HIZLI BİLİŞİM A.Ş.", adres: "Atatürk Cad. Kadıköy İstanbul" },
      alici: { vknTckn: "1234567801", unvan: "ErpClub Test Kurum 01" },
      // Fiili sevk Shipment/Delivery/Despatch altındadır, belge tarihinden farklı olabilir.
      sevkTarihi: "2026-09-11",
      sevkSaati: "07:45:00",
      teslimatAdresi: "OSB 3. Cadde 7 Denizli",
      tasiyici: { vknTckn: "1111111111", unvan: "Hızlı Nakliyat" },
      plaka: "34ABC123",
      dorsePlaka: "34DR4088",
      sofor: "Mehmet Öztürk",
      notlar: ["Kırılacak eşya & dikkat"],
    });
    expect(r.satirlar).toEqual([
      { sira: "1", stokKodu: "KBL-3", ad: "Kablo <3m>", miktar: "5", birim: "C62", birimAdi: "adet", aciklama: "" },
      { sira: "2", stokKodu: "", ad: "Somun", miktar: "12.5", birim: "KGM", birimAdi: "kg", aciklama: "" },
    ]);
  });

  it("fiili sevk yazılmamışsa belge tarihine düşer", () => {
    const r = irsaliyeUblOku(IRSALIYE().replace(/<cac:Despatch>.*<\/cac:Despatch>/, ""));
    expect(r.sevkTarihi).toBe("2026-09-10");
    expect(r.sevkSaati).toBe("14:05:00");
  });

  it("irsaliye olmayan ya da XML olmayan içerikte okuma hatası verir", () => {
    // Ayrıştırıcı bilerek hoşgörülüdür: yarım kalmış bir DespatchAdvice okunur;
    // kökü bulunmayan içerik ise basılacak bir belge değildir.
    expect(() => irsaliyeUblOku("<Invoice/>")).toThrow(IrsaliyeUblOkumaHatasi);
    expect(() => irsaliyeUblOku("düz metin, XML değil")).toThrow(IrsaliyeUblOkumaHatasi);
  });

  it("türü yazılmamış .xslt ekini irsaliyede de görünüm sayar", () => {
    const ek = `<cac:AdditionalDocumentReference><cbc:ID>1</cbc:ID><cbc:IssueDate>2026-09-10</cbc:IssueDate>
      <cac:Attachment><cbc:EmbeddedDocumentBinaryObject filename="gorunum.xslt" mimeCode="application/xml">${XSLT}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
    </cac:AdditionalDocumentReference>`;
    expect(gomuluXsltCikar(IRSALIYE(ek))).toContain("<xsl:stylesheet");
  });
});

describe("eirsaliyeYedekPdfHtml (EBLG-33)", () => {
  const html = eirsaliyeYedekPdfHtml(irsaliyeUblOku(IRSALIYE()));

  it("taşıma bilgilerini, satırları ve yedek görünüm notunu basar", () => {
    for (const parca of ["TYH2026000000016", "f290cda1-acdb-4171-8bd6-c426a75cf8ba", "Hızlı Nakliyat", "34ABC123 / 34DR4088", "Mehmet Öztürk", "OSB 3. Cadde 7 Denizli", "adet", "kg"]) {
      expect(html).toContain(parca);
    }
    expect(html).toContain(EIRSALIYE_YEDEK_GORUNUM_NOTU);
  });

  it("belgeden gelen metni kaçışlar", () => {
    expect(html).toContain("Kablo &lt;3m&gt;");
    expect(html).not.toContain("Kablo <3m>");
  });
});
