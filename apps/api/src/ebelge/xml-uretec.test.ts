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

  // Üçü de NES test ortamında e-Arşiv gönderiminin gerçek reddedilme
  // sebebiydi (2026-09-10): e-Fatura profili, eksik `cac:Person` ve
  // bildirilmeyen gönderim şekli.
  const earsivFaturasi = {
    id: "33333333-3333-4333-8333-333333333333",
    no: "SNC",
    tarih: new Date("2026-09-10T12:00:00Z"),
    tip: "satis",
    senaryo: "satis",
    efaturaProfili: "temel",
    dovizCinsi: "TRY",
    toplamKdv: 600,
    toplamMatrah: 3000,
    toplamBrut: 3000,
    genelToplam: 3600,
    toplamSatirIskontosu: 0,
    cari: { vknTckn: "10000000078", unvan: "Ayşe Yılmaz" },
    satirlar: [{
      miktar: 2, matrah: 3000, iskontoTutari: 0, kdvTutari: 600,
      kdvOrani: 20, gibIstisnaKodu: null, birimFiyat: 1500,
      stok: { kod: "STK-1", ad: "Ürün" },
    }],
  };
  const saglayici = { unvan: "Satıcı A.Ş.", vkn: "1234567801" };

  it("e-Arşiv kanalında EARSIVFATURA profilini ve gönderim şeklini yazar", () => {
    const xml = faturaUblUret(earsivFaturasi as never, saglayici, { tur: "earsiv" });

    expect(xml).toContain("<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>");
    const gonderim = xml.match(/<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/g)!
      .find((blok) => blok.includes("SEND_TYPE"))!;
    expect(gonderim).toContain("<cbc:ID>ELEKTRONIK</cbc:ID>");
  });

  it("e-Fatura kanalında e-Arşiv profilini ve gönderim şeklini yazmaz", () => {
    const xml = faturaUblUret(earsivFaturasi as never, saglayici, { tur: "efatura" });

    expect(xml).toContain("<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>");
    expect(xml).not.toContain("SEND_TYPE");
  });

  it("gerçek kişi alıcıyı PartyName yerine cac:Person ile bildirir", () => {
    const alici = faturaUblUret(earsivFaturasi as never, saglayici, { tur: "earsiv" })
      .match(/<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/)![0];

    expect(alici).toContain('<cbc:ID schemeID="TCKN">10000000078</cbc:ID>');
    // Şematron `schemeID="TCKN"` gördüğünde `cac:Person` arar; ünvanı yalnızca
    // PartyName'e yazmak belgeyi reddettirir.
    expect(alici).toContain("<cbc:FirstName>Ayşe</cbc:FirstName>");
    expect(alici).toContain("<cbc:FamilyName>Yılmaz</cbc:FamilyName>");
    expect(alici).not.toContain("<cac:PartyName>");
  });

  it("tüzel kişi alıcıda ünvanı PartyName'de bırakır", () => {
    const alici = faturaUblUret(
      { ...earsivFaturasi, cari: { vknTckn: "1234567802", unvan: "Alıcı A.Ş." } } as never,
      saglayici,
      { tur: "earsiv" },
    ).match(/<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/)![0];

    expect(alici).toContain('<cbc:ID schemeID="VKN">1234567802</cbc:ID>');
    expect(alici).toContain("<cbc:Name>Alıcı A.Ş.</cbc:Name>");
    expect(alici).not.toContain("<cac:Person>");
  });
});
