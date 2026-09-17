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
});
