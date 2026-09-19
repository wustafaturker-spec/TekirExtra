import { describe, expect, it } from "vitest";
import { belgeNoyuUbleYaz, faturaUblUret } from "./xml-uretec";

describe("faturaUblUret", () => {
  it("belgeye görünüm (XSLT) gömmez — tasarımı entegratör yapar (2026-09-17)", () => {
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

    expect(xml).not.toContain("<cbc:DocumentType>XSLT</cbc:DocumentType>");
    expect(xml).not.toContain("EmbeddedDocumentBinaryObject");
    expect(xml).not.toContain("<xsl:stylesheet");
  });

  it("satır birimini GİB birim koduna çevirir", () => {
    // Birim serbest metindir; UBL `unitCode` bekler. Sabit kod yazmak kiloyla
    // satılan malı adet gösteriyordu.
    const fatura = (birim: string) => ({
      id: "33333333-3333-4333-8333-333333333333",
      no: "TKR2026000000003",
      tarih: new Date("2026-08-12T12:00:00Z"),
      tip: "satis",
      dovizCinsi: "TRY",
      toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120, toplamSatirIskontosu: 0,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
        gibIstisnaKodu: null, birimFiyat: 100, birim,
        stok: { kod: "STK-1", ad: "Ürün" },
      }],
    }) as never;
    const ubl = (birim: string) => faturaUblUret(fatura(birim), { unvan: "Satıcı A.Ş.", vkn: "9876543210" });

    expect(ubl("kg")).toContain('<cbc:InvoicedQuantity unitCode="KGM">');
    expect(ubl("adet")).toContain('<cbc:InvoicedQuantity unitCode="C62">');
    expect(ubl("saat")).toContain('<cbc:InvoicedQuantity unitCode="HUR">');
    // Tanınmayan birimde belge yine geçerli kalır: adet yazılır.
    expect(ubl("zımbırtı")).toContain('<cbc:InvoicedQuantity unitCode="C62">');
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

  it("kâğıt teslim edilecek e-Arşivde gönderim şeklini KAGIT yazar (EBLG-26)", () => {
    const xml = faturaUblUret({ ...earsivFaturasi, earsivGonderimSekli: "kagit" } as never, saglayici, { tur: "earsiv" });

    const gonderim = xml.match(/<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/g)!
      .find((blok) => blok.includes("SEND_TYPE"))!;
    expect(gonderim).toContain("<cbc:ID>KAGIT</cbc:ID>");
  });

  it("gerçek kişi alıcıda karttaki ad ve soyadı yazar, unvandan tahmin etmez (CARI-21)", () => {
    const xml = faturaUblUret(
      { ...earsivFaturasi, cari: { vknTckn: "10000000078", unvan: "Ayşe Nur Yılmaz Demir", ad: "Ayşe Nur", soyad: "Yılmaz Demir" } } as never,
      saglayici,
      { tur: "earsiv" },
    );

    expect(xml).toContain("<cbc:FirstName>Ayşe Nur</cbc:FirstName>");
    expect(xml).toContain("<cbc:FamilyName>Yılmaz Demir</cbc:FamilyName>");
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

describe("faturaUblUret iskonto tutarlılığı", () => {
  // Genel iskonto hesapta satırlara dağıtılır (matrah = brüt − satır iskontosu −
  // genel iskonto payı) ama UBL'e yazılmıyordu: satırda brüt − iskonto matrahı,
  // başlıkta LineExtensionAmount − AllowanceTotalAmount TaxExclusiveAmount'u
  // vermiyordu. Tutarlar faturaHesapla kuralıyla: 19 TL genel iskonto 90:100
  // oranında 9 ve 10 olarak dağılır.
  const xml = faturaUblUret({
    id: "33333333-3333-4333-8333-333333333333",
    no: "TKR2026000000003",
    tarih: new Date("2026-09-13T12:00:00Z"),
    tip: "satis",
    dovizCinsi: "TRY",
    toplamBrut: 200,
    toplamSatirIskontosu: 10,
    genelIskontoToplam: 19,
    toplamMatrah: 171,
    toplamKdv: 34.2,
    genelToplam: 205.2,
    cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
    satirlar: [
      { miktar: 1, birimFiyat: 100, iskontoOrani: 10, iskontoTutari: 10, genelIskontoPayi: 9, matrah: 81, kdvOrani: 20, kdvTutari: 16.2, gibIstisnaKodu: null, stok: { kod: "A", ad: "A" } },
      { miktar: 1, birimFiyat: 100, iskontoOrani: 0, iskontoTutari: 0, genelIskontoPayi: 10, matrah: 90, kdvOrani: 20, kdvTutari: 18, gibIstisnaKodu: null, stok: { kod: "B", ad: "B" } },
    ],
  } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" });

  const tutar = (parca: string, alan: string) => Number(parca.match(new RegExp(`<cbc:${alan}[^>]*>([^<]+)<`))?.[1]);
  const satirlar = xml.split("<cac:InvoiceLine>").slice(1);

  it("başlıkta brüt − toplam iskonto matrahı verir; toplam iskonto genel iskontoyu da içerir", () => {
    const parasal = xml.slice(xml.indexOf("<cac:LegalMonetaryTotal>"), xml.indexOf("</cac:LegalMonetaryTotal>"));
    expect(tutar(parasal, "LineExtensionAmount")).toBe(200);
    expect(tutar(parasal, "AllowanceTotalAmount")).toBe(29);
    expect(tutar(parasal, "TaxExclusiveAmount")).toBe(171);
  });

  it("satırda brüt − iskontolar satır tutarını verir; genel iskonto payı ayrı kayıttır", () => {
    for (const satir of satirlar) {
      const iskontolar = [...satir.matchAll(/<cbc:Amount[^>]*>([^<]+)</g)].map((m) => Number(m[1])).reduce((t, v) => t + v, 0);
      expect(Math.round((100 - iskontolar) * 100) / 100).toBe(tutar(satir, "LineExtensionAmount"));
    }
    // Satır iskontosunun oranı yalnız kendi tutarını tanımlar; pay oransız ayrı kayıttır.
    expect(satirlar[0]).toContain("<cbc:MultiplierFactorNumeric>0.1000</cbc:MultiplierFactorNumeric>");
    expect(satirlar[0].match(/<cac:AllowanceCharge>/g)).toHaveLength(2);
    expect(satirlar[0]).toContain("<cbc:AllowanceChargeReason>Genel iskonto payı</cbc:AllowanceChargeReason>");
  });

  it("genel iskontosuz faturada ek iskonto kaydı yazmaz", () => {
    const sade = faturaUblUret({
      id: "44444444-4444-4444-8444-444444444444", no: "TKR2026000000004", tarih: new Date("2026-09-13T12:00:00Z"), tip: "satis", dovizCinsi: "TRY",
      toplamBrut: 100, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
      satirlar: [{ miktar: 1, birimFiyat: 100, iskontoTutari: 0, genelIskontoPayi: 0, matrah: 100, kdvOrani: 20, kdvTutari: 20, gibIstisnaKodu: null, stok: { kod: "A", ad: "A" } }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" });
    expect(sade).not.toContain("Genel iskonto payı");
    expect(sade).toContain("<cbc:AllowanceTotalAmount currencyID=\"TRY\">0.00</cbc:AllowanceTotalAmount>");
  });
});

describe("belgeNoyuUbleYaz (EBLG-16 arşivi)", () => {
  const ubl = (id: string) =>
    `<Invoice><cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>\n  <cbc:ID>${id}</cbc:ID>\n  <cbc:UUID>u</cbc:UUID>` +
    `<cac:AccountingSupplierParty><cac:PartyIdentification><cbc:ID>1234567801</cbc:ID></cac:PartyIdentification></cac:AccountingSupplierParty>` +
    `<cac:InvoiceLine><cbc:ID>1</cbc:ID></cac:InvoiceLine></Invoice>`;

  it("sağlayıcının attığı numarayı fatura kimliğine yazar", () => {
    const sonuc = belgeNoyuUbleYaz(ubl("SNC"), "SNC2026000000006");
    expect(sonuc).toContain("<cbc:ID>SNC2026000000006</cbc:ID>");
  });

  it("diğer cbc:ID alanlarına dokunmaz — belgede onlarca tane var", () => {
    const sonuc = belgeNoyuUbleYaz(ubl("SNC"), "SNC2026000000006");
    expect(sonuc).toContain("<cbc:ID>1234567801</cbc:ID>");
    expect(sonuc).toContain("<cac:InvoiceLine><cbc:ID>1</cbc:ID>");
  });

  it("numarayı kaçırır ve beklenmedik yapıda XML'i olduğu gibi bırakır", () => {
    expect(belgeNoyuUbleYaz(ubl("SNC"), 'A&B"C')).toContain("<cbc:ID>A&amp;B&quot;C</cbc:ID>");
    const yapisiz = "<Invoice><cbc:ID>X</cbc:ID></Invoice>";
    expect(belgeNoyuUbleYaz(yapisiz, "YENI")).toBe(yapisiz);
  });

  it("gerçek üretilen UBL üzerinde çalışır", () => {
    const xml = faturaUblUret({
      id: "33333333-3333-4333-8333-333333333333", no: "SNC", tarih: new Date("2026-09-12T12:00:00Z"),
      tip: "satis", dovizCinsi: "TRY", toplamKdv: 90, toplamMatrah: 450, toplamBrut: 500,
      genelToplam: 540, toplamSatirIskontosu: 50,
      cari: { vknTckn: "10000000078", unvan: "Ayşe Yılmaz" },
      satirlar: [{ miktar: 2, matrah: 450, iskontoTutari: 50, iskontoOrani: 10, kdvTutari: 90,
        kdvOrani: 20, gibIstisnaKodu: null, birimFiyat: 250, stok: { kod: "S1", ad: "Hizmet" } }],
    } as never, { unvan: "ErpClub", vkn: "1234567801" }, { tur: "earsiv" });
    expect(belgeNoyuUbleYaz(xml, "SNC2026000000006")).toContain("<cbc:ID>SNC2026000000006</cbc:ID>");
  });

  it("ihracat faturasını IHRACAT profiliyle ve gümrük alanlarıyla yazar (EBLG-53)", () => {
    const xml = faturaUblUret({
      id: "44444444-4444-4444-8444-444444444444",
      no: "TKR2026000000004",
      tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis",
      // Sıfır KDV'li satır senaryoyu "istisna" türetir; ihracat faturası yine
      // SATIS tipindedir.
      senaryo: "istisna",
      efaturaProfili: "temel",
      dovizCinsi: "USD",
      kur: 41.5,
      toplamKdv: 0, toplamMatrah: 1000, toplamBrut: 1000, genelToplam: 1000,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: {
        vknTckn: null, unvan: "Muster GmbH",
        adresler: [{ tip: "fatura", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115", ulke: "DE" }],
      },
      satirlar: [{
        miktar: 2, matrah: 1000, iskontoTutari: 0, kdvTutari: 0, kdvOrani: 0,
        gibIstisnaKodu: null, birimFiyat: 500, birim: "kg",
        stok: { kod: "STK-9", ad: "Fındık", tip: "urun", gtipKodu: "080222100000", mensei: "Türkiye" },
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, {
      tur: "efatura",
      ihracat: {
        ulkeKodu: "DE",
        teslimTarihi: new Date("2026-09-20T00:00:00Z"),
        teslimSarti: "FOB",
        tasimaSekli: "1",
      },
    });

    expect(xml).toContain("<cbc:ProfileID>IHRACAT</cbc:ProfileID>");
    // Resmî örnekte ihracatın belge tipi ISTISNA'dır; tasarım belgesi SATIS diyordu.
    expect(xml).toContain("<cbc:InvoiceTypeCode>ISTISNA</cbc:InvoiceTypeCode>");
    // Vergi TRY üzerinden okunur; dövizli faturada kur da belgeye girer.
    expect(xml).toContain("<cbc:TaxCurrencyCode>TRY</cbc:TaxCurrencyCode>");
    expect(xml).toContain("<cac:PricingExchangeRate>");
    expect(xml).toContain("<cbc:CalculationRate>41.500000</cbc:CalculationRate>");
    // Belgenin alıcısı Gümrük Bakanlığı'dır; malı alan yabancı firma ayrı tarafta.
    expect(xml).toContain('<cbc:ID schemeID="VKN">1460415308</cbc:ID>');
    expect(xml).toContain("<cbc:CityName>Ankara</cbc:CityName>");
    const yabanci = xml.match(/<cac:BuyerCustomerParty>[\s\S]*?<\/cac:BuyerCustomerParty>/)![0];
    expect(yabanci).toContain('<cbc:ID schemeID="PARTYTYPE">EXPORT</cbc:ID>');
    expect(yabanci).toContain("<cbc:Name>Muster GmbH</cbc:Name>");
    expect(yabanci).toContain("<cbc:CityName>Berlin</cbc:CityName>");
    expect(yabanci).toContain("<cbc:IdentificationCode>DE</cbc:IdentificationCode>");
    // Teslimat, teslim şartı ve taşıma şekli satır düzeyinde durur.
    const satir = xml.match(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/)![0];
    expect(satir).toContain("<cbc:ActualDeliveryDate>2026-09-20</cbc:ActualDeliveryDate>");
    expect(satir).toContain('<cbc:ID schemeID="INCOTERMS">FOB</cbc:ID>');
    expect(satir).toContain("<cbc:TransportModeCode>1</cbc:TransportModeCode>");
    expect(xml).not.toContain("<cac:Person>");
  });

  it("ihracat satırına GTİP, menşei ve mal ihracatı istisna kodunu yazar (EBLG-53)", () => {
    const ubl = (stok: Record<string, unknown>) => faturaUblUret({
      id: "55555555-5555-4555-8555-555555555555",
      no: "TKR2026000000005",
      tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis", senaryo: "istisna", efaturaProfili: "temel",
      dovizCinsi: "TRY", kur: 1,
      toplamKdv: 0, toplamMatrah: 100, toplamBrut: 100, genelToplam: 100,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: {
        vknTckn: null, unvan: "Muster GmbH",
        adresler: [{ tip: "fatura", adres: null, il: "Berlin", ilce: "Mitte", postaKodu: null, ulke: "DE" }],
      },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 0, kdvOrani: 0,
        gibIstisnaKodu: null, birimFiyat: 100, birim: "adet", stok,
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, {
      tur: "efatura",
      ihracat: { ulkeKodu: "DE", teslimTarihi: new Date("2026-09-20T00:00:00Z") },
    });

    // GTİP, resmî örnekteki yeriyle: satırın gönderi bilgisinde.
    const mal = ubl({ kod: "STK-9", ad: "Fındık", tip: "urun", gtipKodu: "080222100000", mensei: "TR" });
    expect(mal).toContain("<cbc:RequiredCustomsID>080222100000</cbc:RequiredCustomsID>");
    expect(mal).not.toContain("CommodityClassification");
    expect(mal).toContain("<cac:OriginCountry>");
    expect(mal).toContain("<cbc:TaxExemptionReasonCode>301</cbc:TaxExemptionReasonCode>");
    expect(mal).toContain("<cbc:TaxExemptionReason>11/1-a Mal ihracatı</cbc:TaxExemptionReason>");

    // Hizmet ihracatının kodu ayrıdır; menşei çözülemezse hiç yazılmaz.
    const hizmet = ubl({ kod: "HZM-1", ad: "Danışmanlık", tip: "hizmet", gtipKodu: null, mensei: "Zımbırtistan" });
    expect(hizmet).toContain("<cbc:TaxExemptionReasonCode>302</cbc:TaxExemptionReasonCode>");
    expect(hizmet).toContain("<cbc:TaxExemptionReason>11/1-a Hizmet ihracatı</cbc:TaxExemptionReason>");
    expect(hizmet).not.toContain("<cac:OriginCountry>");
    expect(hizmet).not.toContain("RequiredCustomsID");
  });

  it("yurt içi faturaya ihracat alanlarından hiçbirini karıştırmaz", () => {
    const xml = faturaUblUret({
      id: "66666666-6666-4666-8666-666666666666",
      no: "TKR2026000000006",
      tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis", senaryo: "satis", efaturaProfili: "temel",
      dovizCinsi: "TRY", kur: 1,
      toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
        gibIstisnaKodu: null, birimFiyat: 100, birim: "adet",
        stok: { kod: "STK-1", ad: "Ürün", tip: "urun", gtipKodu: "080222100000", mensei: "TR" },
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, { tur: "efatura" });

    expect(xml).toContain("<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>");
    expect(xml).not.toContain("IHRACAT");
    expect(xml).not.toContain("BuyerCustomerParty");
    expect(xml).not.toContain("TaxCurrencyCode");
    expect(xml).not.toContain("CommodityClassification");
    expect(xml).not.toContain("<cac:Delivery>");
    expect(xml).toContain('<cbc:ID schemeID="VKN">1234567890</cbc:ID>');
  });


  it("alıcı adresini cari kartından yazar, sabit şehir uydurmaz (EBLG-55)", () => {
    const fatura = (adresler?: unknown[]) => ({
      id: "77777777-7777-4777-8777-777777777777",
      no: "TKR2026000000007",
      tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis", senaryo: "satis", efaturaProfili: "temel",
      dovizCinsi: "TRY", kur: 1,
      toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş.", adresler },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
        gibIstisnaKodu: null, birimFiyat: 100, birim: "adet",
        stok: { kod: "STK-1", ad: "Ürün" },
      }],
    }) as never;
    const ubl = (adresler?: unknown[]) => faturaUblUret(fatura(adresler), { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, { tur: "efatura" });

    const kartli = ubl([
      { tip: "sevk", adres: "Depo Yolu 5", il: "Kocaeli", ilce: "Gebze", postaKodu: "41400", ulke: "TR" },
      { tip: "fatura", adres: "Atatürk Cad. 1", il: "İstanbul", ilce: "Kadıköy", postaKodu: "34710", ulke: "TR" },
    ]);
    // Fatura adresi sevk adresine yeğlenir.
    expect(kartli).toContain("<cbc:StreetName>Atatürk Cad. 1</cbc:StreetName>");
    expect(kartli).toContain("<cbc:CityName>İstanbul</cbc:CityName>");
    expect(kartli).toContain("<cbc:CitySubdivisionName>Kadıköy</cbc:CitySubdivisionName>");
    expect(kartli).toContain("<cbc:PostalZone>34710</cbc:PostalZone>");
    expect(kartli).toContain("<cbc:IdentificationCode>TR</cbc:IdentificationCode>");

    // Kartta adres yoksa şehir uydurulmaz; alanlar boş görünür.
    const adressiz = ubl([]);
    expect(adressiz).toContain("<cbc:CityName>-</cbc:CityName>");
    expect(adressiz).toContain("<cbc:CitySubdivisionName>-</cbc:CitySubdivisionName>");
    expect(adressiz).not.toContain("<cbc:StreetName>");
    // Satıcı tarafına artık sabit şehir yazılmaz (EBLG-62).
    expect(ubl()).not.toContain("Istanbul");
  });


  it("e-Arşiv internet satışında sipariş, ödeme ve gönderi bilgisini yazar (EBLG-56)", () => {
    const fatura = {
      id: "88888888-8888-4888-8888-888888888888",
      no: "SNC2026000000008",
      tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis", senaryo: "satis", efaturaProfili: "temel",
      earsivGonderimSekli: "elektronik",
      siparisNo: "SIP-2026-001", siparisTarihi: new Date("2026-09-15T00:00:00Z"),
      dovizCinsi: "TRY", kur: 1,
      toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: {
        vknTckn: "10000000078", unvan: "Ayşe Yılmaz", ad: "Ayşe", soyad: "Yılmaz",
        adresler: [{ tip: "sevk", adres: "Bağdat Cad. 9", il: "İstanbul", ilce: "Maltepe", postaKodu: "34840", ulke: "TR" }],
      },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
        gibIstisnaKodu: null, birimFiyat: 100, birim: "adet",
        stok: { kod: "STK-1", ad: "Ürün" },
      }],
    } as never;
    const internetSatisi = {
      webAdresi: "https://magaza.example.com",
      odemeSekli: "kredi_karti",
      odemeTarihi: new Date("2026-09-15T00:00:00Z"),
      odemeAracisi: "iyzico",
      tasiyiciUnvan: "Hızlı Kargo A.Ş.",
      tasiyiciVkn: "1234567890",
      gonderiTarihi: new Date("2026-09-16T00:00:00Z"),
      teslimatAdresi: { adres: "Bağdat Cad. 9", il: "İstanbul", ilce: "Maltepe", postaKodu: "34840", ulke: "TR" },
    };
    const satici = { unvan: "Satıcı A.Ş.", vkn: "9876543210" };

    const earsiv = faturaUblUret(fatura, satici, { tur: "earsiv", internetSatisi });
    expect(earsiv).toContain("<cac:OrderReference>");
    expect(earsiv).toContain("<cbc:ID>SIP-2026-001</cbc:ID>");
    expect(earsiv).toContain("<cbc:IssueDate>2026-09-15</cbc:IssueDate>");
    expect(earsiv).toContain("İnternet satışı — https://magaza.example.com");
    expect(earsiv).toContain("<cbc:ActualDeliveryDate>2026-09-16</cbc:ActualDeliveryDate>");
    expect(earsiv).toContain("<cac:DeliveryAddress>");
    expect(earsiv).toContain("<cbc:CityName>İstanbul</cbc:CityName>");
    expect(earsiv).toContain("<cbc:Name>Hızlı Kargo A.Ş.</cbc:Name>");
    expect(earsiv).toContain("<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>");
    expect(earsiv).toContain("<cbc:PaymentDueDate>2026-09-15</cbc:PaymentDueDate>");
    expect(earsiv).toContain("<cbc:InstructionNote>iyzico</cbc:InstructionNote>");

    // e-Fatura kanalında grup istenmez; sipariş referansı iş bilgisi olarak kalır.
    const efatura = faturaUblUret(fatura, satici, { tur: "efatura", internetSatisi });
    expect(efatura).toContain("<cac:OrderReference>");
    expect(efatura).not.toContain("<cac:PaymentMeans>");
    expect(efatura).not.toContain("<cac:Delivery>");
    expect(efatura).not.toContain("İnternet satışı");
  });

  it("sipariş numarası olmayan faturaya sipariş referansı yazmaz", () => {
    const xml = faturaUblUret({
      id: "99999999-9999-4999-8999-999999999999",
      no: "TKR2026000000009", tarih: new Date("2026-09-18T12:00:00Z"),
      tip: "satis", senaryo: "satis", efaturaProfili: "temel",
      dovizCinsi: "TRY", kur: 1,
      toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120,
      toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş.", adresler: [] },
      satirlar: [{
        miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
        gibIstisnaKodu: null, birimFiyat: 100, birim: "adet", stok: { kod: "STK-1", ad: "Ürün" },
      }],
    } as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, { tur: "efatura" });

    expect(xml).not.toContain("<cac:OrderReference>");
  });

});

describe("faturaUblUret — iade referansı (EBLG-58)", () => {
  const iadeFaturasi = {
    id: "55555555-5555-4555-8555-555555555555",
    no: "TKR2026000000009",
    tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "alis_iade",
    senaryo: "iade",
    dovizCinsi: "TRY",
    toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120, toplamSatirIskontosu: 0,
    siparisNo: "SIP-7",
    cari: { vknTckn: "1234567890", unvan: "Tedarikçi A.Ş." },
    satirlar: [{
      miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
      gibIstisnaKodu: null, birimFiyat: 100, stok: { kod: "STK-1", ad: "Ürün" },
    }],
  } as never;
  const satici = { unvan: "Satıcı A.Ş.", vkn: "9876543210" };

  it("iade edilen her fatura için şematronun aradığı referansı yazar", () => {
    const xml = faturaUblUret(iadeFaturasi, satici, {
      iadeReferanslari: [
        { belgeNo: "ABC2026000000001", tarih: new Date("2026-09-10T00:00:00Z") },
        { belgeNo: "ABC2026000000002", tarih: new Date("2026-09-11T00:00:00Z") },
      ],
    });
    expect(xml).toContain("<cbc:InvoiceTypeCode>IADE</cbc:InvoiceTypeCode>");
    const bloklar = xml.match(/<cac:BillingReference>[\s\S]*?<\/cac:BillingReference>/g)!;
    expect(bloklar).toHaveLength(2);
    expect(bloklar[0]).toContain("<cbc:ID>ABC2026000000001</cbc:ID>");
    expect(bloklar[0]).toContain("<cbc:IssueDate>2026-09-10</cbc:IssueDate>");
    expect(bloklar[0]).toContain("<cbc:DocumentTypeCode>IADE</cbc:DocumentTypeCode>");
    // UBL şeması sırayı dayatır: OrderReference → BillingReference → Signature.
    expect(xml.indexOf("<cac:OrderReference>")).toBeLessThan(xml.indexOf("<cac:BillingReference>"));
    expect(xml.lastIndexOf("</cac:BillingReference>")).toBeLessThan(xml.indexOf("<cac:Signature>"));
  });

  it("referans verilmeyen belgeye blok yazmaz", () => {
    expect(faturaUblUret(iadeFaturasi, satici)).not.toContain("BillingReference");
  });
});

describe("faturaUblUret — KDV alt toplamları ve istisna (EBLG-59)", () => {
  const satir = (kdvOrani: number, gibIstisnaKodu: string | null, ek: Record<string, unknown> = {}) => ({
    miktar: 1, birimFiyat: 100, iskontoTutari: 0, matrah: 100, kdvOrani, kdvTutari: kdvOrani, gibIstisnaKodu,
    stok: { kod: "STK-1", ad: "Ürün" }, ...ek,
  });
  const fatura = (satirlar: unknown[], ek: Record<string, unknown> = {}) => ({
    id: "66666666-6666-4666-8666-666666666666", no: "TKR2026000000010", tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "satis", senaryo: "istisna", dovizCinsi: "TRY",
    toplamKdv: 20, toplamMatrah: 200, toplamBrut: 200, genelToplam: 220, toplamSatirIskontosu: 0,
    cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." }, satirlar, ...ek,
  }) as never;
  const satici = { unvan: "Satıcı A.Ş.", vkn: "9876543210" };
  const belgeVergisi = (xml: string) => xml.slice(xml.indexOf("<cac:TaxTotal>"), xml.indexOf("</cac:TaxTotal>"));

  it("istisna kodunu ve açıklamasını belge düzeyinde, oran başına alt toplamla yazar", () => {
    const vergi = belgeVergisi(faturaUblUret(fatura([satir(20, null), satir(0, "301")]), satici));
    const altToplamlar = vergi.match(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g)!;
    expect(altToplamlar).toHaveLength(2);
    expect(altToplamlar[0]).toContain("<cbc:Percent>20.00</cbc:Percent>");
    expect(altToplamlar[0]).not.toContain("TaxExemptionReasonCode");
    expect(altToplamlar[1]).toContain("<cbc:TaxExemptionReasonCode>301</cbc:TaxExemptionReasonCode>");
    expect(altToplamlar[1]).toContain("<cbc:TaxExemptionReason>301 11/1-a Mal İhracatı</cbc:TaxExemptionReason>");
    expect(altToplamlar[1]).toContain('<cbc:TaxableAmount currencyID="TRY">100.00</cbc:TaxableAmount>');
  });

  it("aynı oran ve kodlu satırları tek alt toplamda kuruşuyla toplar", () => {
    const vergi = belgeVergisi(faturaUblUret(fatura([satir(0, "351", { matrah: 0.1 }), satir(0, "351", { matrah: 0.2 })]), satici));
    expect(vergi.match(/<cac:TaxSubtotal>/g)).toHaveLength(1);
    expect(vergi).toContain('<cbc:TaxableAmount currencyID="TRY">0.30</cbc:TaxableAmount>');
  });

  it("satırda da istisna açıklamasını yazar", () => {
    const xml = faturaUblUret(fatura([satir(0, "201")]), satici);
    const satirVergisi = xml.slice(xml.indexOf("<cac:InvoiceLine>"));
    expect(satirVergisi).toContain("<cbc:TaxExemptionReason>201 17/1 Kültür ve Eğitim Amacı Taşıyan İşlemler</cbc:TaxExemptionReason>");
  });

  it("tevkifat yüzdesini kod listesindeki gibi ondalıksız yazar", () => {
    const xml = faturaUblUret(fatura([satir(20, null, { tevkifatKodu: "602", tevkifatTutari: 18, tevkifatPay: 9, tevkifatPayda: 10 })], { senaryo: "tevkifat" }), satici);
    const tevkifat = xml.slice(xml.indexOf("<cac:WithholdingTaxTotal>"), xml.indexOf("</cac:WithholdingTaxTotal>"));
    expect(tevkifat).toContain("<cbc:Percent>90</cbc:Percent>");
  });

  it("iade faturası carinin ticari profiline rağmen TEMELFATURA gider", () => {
    const xml = faturaUblUret(fatura([satir(20, null)], { tip: "alis_iade", senaryo: "iade", efaturaProfili: "ticari" }), satici);
    expect(xml).toContain("<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>");
    expect(faturaUblUret(fatura([satir(20, null)], { senaryo: "satis", efaturaProfili: "ticari" }), satici)).toContain("<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>");
  });
});

describe("faturaUblUret — ihraç kayıtlı satış (EBLG-60)", () => {
  // Kullanıcının kabul edilmiş örneği M012026000000078: %10 KDV hesaplanır ve
  // 701 koduyla gösterilir, ödenecek tutar yalnız matrahtır.
  const fatura = {
    id: "77777777-7777-4777-8777-777777777777", no: "TKR2026000000011", tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "satis", senaryo: "ihrackayitli", ihracKayitliKodu: "701", dovizCinsi: "TRY",
    toplamKdv: 10966.03, toplamMatrah: 109660.29, toplamBrut: 109660.29, genelToplam: 109660.29, toplamSatirIskontosu: 0,
    cari: { vknTckn: "0680054120", unvan: "İhracatçı Ltd." },
    satirlar: [{
      miktar: 7000, birimFiyat: 15.665755, iskontoTutari: 0, matrah: 109660.29, kdvOrani: 10, kdvTutari: 10966.03,
      gibIstisnaKodu: null, stok: { kod: "SF0101", ad: "Mumlu bez" },
    }],
  } as never;
  const xml = faturaUblUret(fatura, { unvan: "Satıcı A.Ş.", vkn: "9876543210" });

  it("tipi IHRACKAYITLI yazar, KDV'li alt toplama 701 kodunu ve açıklamasını koyar", () => {
    expect(xml).toContain("<cbc:InvoiceTypeCode>IHRACKAYITLI</cbc:InvoiceTypeCode>");
    const belge = xml.slice(xml.indexOf("<cac:TaxTotal>"), xml.indexOf("</cac:TaxTotal>"));
    expect(belge).toContain("<cbc:Percent>10.00</cbc:Percent>");
    expect(belge).toContain('<cbc:TaxAmount currencyID="TRY">10966.03</cbc:TaxAmount>');
    expect(belge).toContain("<cbc:TaxExemptionReasonCode>701</cbc:TaxExemptionReasonCode>");
    expect(belge).toContain("<cbc:TaxExemptionReason>701 3065 s. KDV Kanununun 11/1-c md. Kapsamındaki İhraç Kayıtlı Satış</cbc:TaxExemptionReason>");
    expect(xml.slice(xml.indexOf("<cac:InvoiceLine>"))).toContain("<cbc:TaxExemptionReasonCode>701</cbc:TaxExemptionReasonCode>");
  });

  it("KDV dahil tutarı gösterir ama ödenecek yalnız matrahtır", () => {
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="TRY">120626.32</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="TRY">109660.29</cbc:PayableAmount>');
  });
});

describe("faturaUblUret — tevkifatlı faturanın iadesi (EBLG-61)", () => {
  // 100 TL, %20 KDV, 602 (9/10): satıcıya ödenmiş KDV 2 TL; iade 100 + 2.
  const fatura = {
    id: "88888888-8888-4888-8888-888888888888", no: "TKR2026000000012", tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "alis_iade", senaryo: "tevkifatiade", efaturaProfili: "ticari", dovizCinsi: "TRY",
    toplamKdv: 20, toplamTevkifat: 18, toplamNetKdv: 2, toplamMatrah: 100, toplamBrut: 100, genelToplam: 102, toplamSatirIskontosu: 0,
    cari: { vknTckn: "1234567890", unvan: "Tedarikçi A.Ş." },
    satirlar: [{
      miktar: 1, birimFiyat: 100, iskontoTutari: 0, matrah: 100, kdvOrani: 20, kdvTutari: 20, netKdvTutari: 2,
      tevkifatKodu: "602", tevkifatTutari: 18, tevkifatPay: 9, tevkifatPayda: 10, gibIstisnaKodu: null,
      stok: { kod: "STK-1", ad: "Hizmet" },
    }],
  } as never;
  const xml = faturaUblUret(fatura, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, {
    iadeReferanslari: [{ belgeNo: "ABC2026000000001", tarih: new Date("2026-09-10T00:00:00Z") }],
  });

  it("TEVKIFATIADE tipinde, tevkifat bloğu olmadan, yalnız tevkif dışı KDV'yle yazar", () => {
    expect(xml).toContain("<cbc:InvoiceTypeCode>TEVKIFATIADE</cbc:InvoiceTypeCode>");
    expect(xml).not.toContain("WithholdingTaxTotal");
    const belge = xml.slice(xml.indexOf("<cac:TaxTotal>"), xml.indexOf("</cac:TaxTotal>"));
    expect(belge).toContain('<cbc:TaxAmount currencyID="TRY">2.00</cbc:TaxAmount>');
    expect(belge).toContain("<cbc:Percent>20.00</cbc:Percent>");
    expect(xml.slice(xml.indexOf("<cac:InvoiceLine>"))).toContain('<cbc:TaxAmount currencyID="TRY">2.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="TRY">102.00</cbc:PayableAmount>');
  });

  it("iade gibi referans taşır ve TEMELFATURA gider", () => {
    expect(xml).toContain("<cbc:DocumentTypeCode>IADE</cbc:DocumentTypeCode>");
    expect(xml).toContain("<cbc:ProfileID>TEMELFATURA</cbc:ProfileID>");
  });
});

describe("faturaUblUret — satıcı bilgisi firma kartından (EBLG-62)", () => {
  const fatura = {
    id: "99999999-9999-4999-8999-999999999999", no: "TKR2026000000013", tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "satis", senaryo: "satis", dovizCinsi: "TRY",
    toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120, toplamSatirIskontosu: 0,
    cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." },
    satirlar: [{ miktar: 1, birimFiyat: 100, iskontoTutari: 0, matrah: 100, kdvOrani: 20, kdvTutari: 20, gibIstisnaKodu: null, stok: { kod: "S", ad: "Ürün" } }],
  } as never;
  const firma = {
    unvan: "KA Grup Ltd.", vkn: "5240004634", vergiDairesi: "Davutpaşa",
    adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7/2", ilce: "Zeytinburnu", il: "İstanbul", postaKodu: "34010",
    telefon: "2124819113", eposta: "info@firma.test", webSitesi: "www.firma.test",
    mersisNo: "0524000463400019", ticaretSicilNo: "325632",
  };
  const xml = faturaUblUret(fatura, firma);
  const satici = xml.slice(xml.indexOf("<cac:AccountingSupplierParty>"), xml.indexOf("</cac:AccountingSupplierParty>"));

  it("adresi, vergi dairesini ve iletişimi yazar; uydurma değer kalmaz", () => {
    expect(satici).toContain("<cbc:StreetName>Maltepe Mh. Çırpıcı Yol Sk. No:7/2</cbc:StreetName>");
    expect(satici).toContain("<cbc:CitySubdivisionName>Zeytinburnu</cbc:CitySubdivisionName>");
    expect(satici).toContain("<cbc:CityName>İstanbul</cbc:CityName>");
    expect(satici).toContain("<cbc:PostalZone>34010</cbc:PostalZone>");
    expect(satici).toContain("<cbc:Name>Davutpaşa</cbc:Name>");
    expect(satici).toContain("<cbc:Telephone>2124819113</cbc:Telephone>");
    expect(satici).toContain("<cbc:ElectronicMail>info@firma.test</cbc:ElectronicMail>");
    expect(xml).not.toContain("Marmara V.D.");
    expect(xml).not.toContain(">Merkez<");
  });

  it("web sitesini, MERSİS ve ticaret sicil numarasını UBL sırasıyla yazar", () => {
    expect(satici).toContain('<cbc:ID schemeID="MERSISNO">0524000463400019</cbc:ID>');
    expect(satici).toContain('<cbc:ID schemeID="TICARETSICILNO">325632</cbc:ID>');
    // Party içinde WebsiteURI kimliklerden, kimlikler addan önce gelir.
    expect(satici.indexOf("<cbc:WebsiteURI>")).toBeLessThan(satici.indexOf("<cac:PartyIdentification>"));
    expect(satici.lastIndexOf("</cac:PartyIdentification>")).toBeLessThan(satici.indexOf("<cac:PartyName>"));
    expect(satici.indexOf("<cac:PartyTaxScheme>")).toBeLessThan(satici.indexOf("<cac:Contact>"));
  });

  it("imza tarafında da aynı adres durur", () => {
    const imza = xml.slice(xml.indexOf("<cac:Signature>"), xml.indexOf("</cac:Signature>"));
    expect(imza).toContain("<cbc:CitySubdivisionName>Zeytinburnu</cbc:CitySubdivisionName>");
  });
});

describe("faturaUblUret — KAMU senaryosu", () => {
  const fatura = (ek: Record<string, unknown> = {}) => ({
    id: "88888888-8888-4888-8888-888888888888",
    no: "TKR2026000000008",
    tarih: new Date("2026-09-19T12:00:00Z"),
    tip: "satis", senaryo: "satis", efaturaProfili: "ticari",
    dovizCinsi: "TRY", kur: 1,
    toplamKdv: 20, toplamMatrah: 100, toplamBrut: 100, genelToplam: 120,
    toplamSatirIskontosu: 0, genelIskontoToplam: 0,
    cari: { vknTckn: "2222222105", unvan: "Kamu İhale Kurumu", adresler: [{ tip: "fatura", adres: "Mevlana Blv. 1", il: "Ankara", ilce: "Çankaya", postaKodu: null, ulke: "TR" }] },
    satirlar: [{
      miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20,
      gibIstisnaKodu: null, birimFiyat: 100, birim: "adet",
      stok: { kod: "STK-1", ad: "Ürün" },
    }],
    ...ek,
  }) as never;
  const satici = { unvan: "Satıcı A.Ş.", vkn: "9876543210" };
  const kamu = { harcamaBirimiVkn: "1288331521", harcamaBirimiAdi: "Destek Hizmetleri Daire Başkanlığı", iban: "tr33 0006 1005 1978 6457 8413 26" };

  it("profili KAMU yazar; ticari profil seçili olsa bile", () => {
    const xml = faturaUblUret(fatura(), satici, { tur: "efatura", kamu });
    expect(xml).toContain("<cbc:ProfileID>KAMU</cbc:ProfileID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>");
  });

  it("harcama birimini BuyerCustomerParty'ye, IBAN'ı PaymentMeans'e yazar; alıcı yerinde kalır", () => {
    const xml = faturaUblUret(fatura(), satici, { tur: "efatura", kamu });
    const alici = xml.slice(xml.indexOf("<cac:AccountingCustomerParty>"), xml.indexOf("</cac:AccountingCustomerParty>"));
    expect(alici).toContain('<cbc:ID schemeID="VKN">2222222105</cbc:ID>');
    const harcama = xml.slice(xml.indexOf("<cac:BuyerCustomerParty>"), xml.indexOf("</cac:BuyerCustomerParty>"));
    expect(harcama).toContain('<cbc:ID schemeID="VKN">1288331521</cbc:ID>');
    expect(harcama).toContain("<cbc:Name>Destek Hizmetleri Daire Başkanlığı</cbc:Name>");
    expect(harcama).toContain("<cbc:CityName>Ankara</cbc:CityName>");
    const odeme = xml.slice(xml.indexOf("<cac:PaymentMeans>"), xml.indexOf("</cac:PaymentMeans>"));
    expect(odeme).toContain("<cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>");
    expect(odeme).toContain("<cbc:ID>TR330006100519786457841326</cbc:ID>");
    expect(odeme).toContain("<cbc:CurrencyCode>TRY</cbc:CurrencyCode>");
    // UBL sırası: alıcı → harcama birimi → ödeme → vergi.
    expect(xml.indexOf("</cac:AccountingCustomerParty>")).toBeLessThan(xml.indexOf("<cac:BuyerCustomerParty>"));
    expect(xml.indexOf("</cac:BuyerCustomerParty>")).toBeLessThan(xml.indexOf("<cac:PaymentMeans>"));
    expect(xml.indexOf("</cac:PaymentMeans>")).toBeLessThan(xml.indexOf("<cac:TaxTotal>"));
  });

  it("KAMU iadesinde tip IADE kalır, referanslar yazılır", () => {
    const xml = faturaUblUret(fatura({ tip: "alis_iade", senaryo: "iade" }), satici, {
      tur: "efatura", kamu, iadeReferanslari: [{ belgeNo: "KIK2026000000001", tarih: new Date("2026-09-10") }],
    });
    expect(xml).toContain("<cbc:ProfileID>KAMU</cbc:ProfileID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>IADE</cbc:InvoiceTypeCode>");
    expect(xml).toContain("<cbc:ID>KIK2026000000001</cbc:ID>");
  });

  it("kamu bilgisi yoksa hiçbir KAMU alanı yazılmaz; e-Arşiv'de yok sayılır", () => {
    expect(faturaUblUret(fatura(), satici, { tur: "efatura" })).not.toContain("BuyerCustomerParty");
    const earsiv = faturaUblUret(fatura(), satici, { tur: "earsiv", kamu });
    expect(earsiv).toContain("<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>");
    expect(earsiv).not.toContain("PayeeFinancialAccount");
  });
});
