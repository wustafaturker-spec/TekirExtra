import { describe, expect, it } from "vitest";
import { faturaUblUret } from "./xml-uretec";

describe("faturaUblUret", () => {
  it("Sovos/GİB görüntüleyicisi için XSLT'yi UBL içine gömer", () => {
    const xml = faturaUblUret({
      id: "11111111-1111-4111-8111-111111111111",
      no: "TKR2026000000001",
      tarih: new Date("2026-08-12T12:00:00Z"),
      tip: "satis",
      dovizCinsi: "TRY",
      toplamKdv: 20,
      toplamMatrah: 100,
      toplamBrut: 100,
      genelToplam: 120,
      toplamSatirIskontosu: 0,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20,
        kdvOrani: 20, gibIstisnaKodu: null, birimFiyat: 100,
        stok: { kod: "STK-1", ad: "Ürün" },
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" });

    expect(xml).toContain("<cbc:DocumentTypeCode>XSLT</cbc:DocumentTypeCode>");
    expect(xml).toContain('filename="TKR2026000000001.xslt"');
    const base64 = xml.match(/<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</)?.[1];
    expect(Buffer.from(base64!, "base64").toString("utf8")).toContain("<xsl:stylesheet");
  });

  it("UBL-TR şema ve şematron kontrollerini geçen zorunlu alanları yazar", () => {
    // Üçü de NES test ortamında gerçek reddedilme sebebiydi (2026-09-09):
    // SignatoryParty eksik içerik, PostalAddress'te sıra dışı CityName ve
    // schemaLocation'da GİB URL'i.
    const xml = faturaUblUret({
      id: "22222222-2222-4222-8222-222222222222",
      no: "K07",
      tarih: new Date("2026-09-09T12:00:00Z"),
      tip: "satis",
      senaryo: "satis",
      efaturaProfili: "temel",
      dovizCinsi: "TRY",
      toplamKdv: 400,
      toplamMatrah: 2000,
      toplamBrut: 2000,
      genelToplam: 2400,
      toplamSatirIskontosu: 0,
      cari: { vknTckn: "1234567802", unvan: "Alıcı A.Ş." },
      satirlar: [{
        miktar: 2, matrah: 2000, iskontoTutari: 0, kdvTutari: 400,
        kdvOrani: 20, gibIstisnaKodu: null, birimFiyat: 1000,
        stok: { kod: "STK-1", ad: "Ürün" },
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "1234567801" });

    const imza = xml.match(/<cac:SignatoryParty>[\s\S]*?<\/cac:SignatoryParty>/)![0];
    expect(imza).toContain("<cac:PartyName>");
    expect(imza).toContain("<cac:PostalAddress>");

    // CitySubdivisionName UBL-TR dizisinde CityName'den önce gelmek zorundadır.
    for (const adres of xml.match(/<cac:PostalAddress>[\s\S]*?<\/cac:PostalAddress>/g) ?? []) {
      if (!adres.includes("<cbc:CityName>")) continue;
      expect(adres.indexOf("<cbc:CitySubdivisionName>")).toBeGreaterThanOrEqual(0);
      expect(adres.indexOf("<cbc:CitySubdivisionName>")).toBeLessThan(adres.indexOf("<cbc:CityName>"));
    }

    expect(xml).toContain('xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd"');
    expect(xml).not.toContain("gib.gov.tr/schemas");
  });
});
