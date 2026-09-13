import { describe, expect, it } from "vitest";
import { ebelgeYedekPdfHtml } from "./ebelge-pdf";
import { karekodDataUri, karekoduHtmlEkle } from "./karekod";
import { faturaKarekodVerisi, faturaUblOku } from "./ubl-oku";
import { faturaUblUret } from "./xml-uretec";

const SATIR = { iskontoTutari: 0, gibIstisnaKodu: null, miktar: 1, stok: { kod: "STK-1", ad: "Ürün" } };

const FATURA = {
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
  satirlar: [{ ...SATIR, matrah: 100, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100 }],
};

const ubl = (fatura: object = FATURA, tur?: "efatura" | "earsiv") =>
  faturaUblUret(fatura as never, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, tur ? { tur } : undefined);

const sarmala = (icerik: string) =>
  `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">${icerik}</Invoice>`;

describe("faturaKarekodVerisi (EBLG-32)", () => {
  it("kendi ürettiğimiz e-Faturadan kılavuzdaki alanları, kılavuzdaki sırayla çıkarır", () => {
    const xml = ubl();
    const okunan = faturaUblOku(xml);
    const veri = faturaKarekodVerisi(xml);

    expect(veri).toEqual({
      vkntckn: "9876543210",
      avkntckn: "1234567890",
      senaryo: okunan.profilId,
      tip: okunan.faturaTipKodu,
      tarih: "2026-08-12",
      no: "TKR2026000000001",
      ettn: okunan.uuid,
      parabirimi: "TRY",
      malhizmettoplam: "100.00",
      "kdvmatrah(20)": "100.00",
      "hesaplanankdv(20)": "20.00",
      vergidahil: "120.00",
      odenecek: "120.00",
    });
    expect(Object.keys(veri!)).toEqual([
      "vkntckn", "avkntckn", "senaryo", "tip", "tarih", "no", "ettn", "parabirimi",
      "malhizmettoplam", "kdvmatrah(20)", "hesaplanankdv(20)", "vergidahil", "odenecek",
    ]);
  });

  it("e-Arşiv belgesinde senaryo EARSIVFATURA'dır", () => {
    expect(faturaKarekodVerisi(ubl(FATURA, "earsiv"))?.senaryo).toBe("EARSIVFATURA");
  });

  it("sağlayıcı numarayı henüz atamamışsa (UBL'de yalnız seri öneki) karekod üretmez", () => {
    expect(faturaKarekodVerisi(ubl({ ...FATURA, no: "SNC" }))).toBeNull();
  });

  it("başlıkta oran yoksa KDV'yi satırlardan orana göre gruplar", () => {
    const iki = {
      ...FATURA,
      toplamKdv: 25, toplamMatrah: 150, toplamBrut: 150, genelToplam: 175,
      satirlar: [
        { ...SATIR, matrah: 100, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100 },
        { ...SATIR, matrah: 30, kdvTutari: 3, kdvOrani: 10, birimFiyat: 30 },
        { ...SATIR, matrah: 20, kdvTutari: 2, kdvOrani: 10, birimFiyat: 20 },
      ],
    };
    const veri = faturaKarekodVerisi(ubl(iki))!;
    expect(veri["kdvmatrah(10)"]).toBe("50.00");
    expect(veri["hesaplanankdv(10)"]).toBe("5.00");
    expect(veri["kdvmatrah(20)"]).toBe("100.00");
    expect(veri["hesaplanankdv(20)"]).toBe("20.00");
    expect(Object.keys(veri).filter((k) => k.startsWith("kdvmatrah"))).toEqual(["kdvmatrah(10)", "kdvmatrah(20)"]);
  });

  it("başlıktaki alt toplamlar oranı taşıyorsa satırlara inmeden onları kullanır; sıfır oran da oran sayılır", () => {
    const veri = faturaKarekodVerisi(sarmala(`
      <cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>ABC2026000000042</cbc:ID>
      <cbc:UUID>22222222-2222-4222-8222-222222222222</cbc:UUID><cbc:IssueDate>2026-09-01</cbc:IssueDate>
      <cbc:InvoiceTypeCode>ISTISNA</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0999</cbc:ID></cac:PartyIdentification><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification></cac:Party></cac:AccountingSupplierParty>
      <cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="TCKN">10000000078</cbc:ID></cac:PartyIdentification></cac:Party></cac:AccountingCustomerParty>
      <cac:TaxTotal><cbc:TaxAmount>0</cbc:TaxAmount>
        <cac:TaxSubtotal><cbc:TaxableAmount>500</cbc:TaxableAmount><cbc:TaxAmount>0</cbc:TaxAmount><cbc:Percent>0</cbc:Percent>
          <cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>500</cbc:LineExtensionAmount><cbc:TaxInclusiveAmount>500</cbc:TaxInclusiveAmount><cbc:PayableAmount>500</cbc:PayableAmount></cac:LegalMonetaryTotal>
      <cac:InvoiceLine><cbc:LineExtensionAmount>999</cbc:LineExtensionAmount></cac:InvoiceLine>`))!;
    expect(veri.vkntckn).toBe("1111111111");
    expect(veri.avkntckn).toBe("10000000078");
    expect(veri.parabirimi).toBe("USD");
    expect(veri["kdvmatrah(0)"]).toBe("500.00");
    expect(veri["hesaplanankdv(0)"]).toBe("0.00");
    expect(veri.odenecek).toBe("500.00");
  });

  it("okunamayan XML'de karekod üretmez", () => {
    expect(faturaKarekodVerisi("<bozuk")).toBeNull();
  });
});

describe("karekodun sayfaya basılması (EBLG-32)", () => {
  const uri = karekodDataUri({ no: "TKR2026000000001" });

  it("karekodu SVG data URI olarak üretir", () => {
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1], "base64").toString("utf8")).toContain("<svg");
  });

  it("belgenin kendi görünümünde karekodu gövdenin başına ekler", () => {
    const html = karekoduHtmlEkle('<html><head></head><body class="a"><h1>e-FATURA</h1></body></html>', uri);
    expect(html.indexOf(uri)).toBeGreaterThan(html.indexOf('<body class="a">'));
    expect(html.indexOf(uri)).toBeLessThan(html.indexOf("<h1>"));
  });

  it("yedek görünümde karekod verilince basar, verilmezse basmaz", () => {
    const fatura = faturaUblOku(ubl());
    expect(ebelgeYedekPdfHtml(fatura, { karekodDataUri: uri })).toContain(uri);
    expect(ebelgeYedekPdfHtml(fatura)).not.toContain("GİB karekodu");
  });
});
