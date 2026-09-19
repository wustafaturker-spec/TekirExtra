import { describe, expect, it } from "vitest";
import { EBELGE_YEDEK_GORUNUM_NOTU, ebelgeYedekPdfHtml } from "./ebelge-pdf";
import { gomuluXsltCikar } from "./ubl-gorunum";
import { faturaUblUret } from "./xml-uretec";
import { faturaUblOku } from "./ubl-oku";

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
  satirlar: [{
    miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20,
    kdvOrani: 20, gibIstisnaKodu: null, birimFiyat: 100,
    stok: { kod: "STK-1", ad: "Ürün" },
  }],
} as never;

const ubl = (secenekler?: { tur?: "efatura" | "earsiv" }) =>
  faturaUblUret(FATURA, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }, secenekler);

const sarmala = (icerik: string) =>
  `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">${icerik}</Invoice>`;

describe("gomuluXsltCikar (EBLG-28)", () => {
  it("gönderenin gömdüğü görünümü çıkarır", () => {
    const gonderenBelgesi = sarmala(`<AdditionalDocumentReference>
      <DocumentTypeCode>XSLT</DocumentTypeCode>
      <Attachment><EmbeddedDocumentBinaryObject>${Buffer.from('<xsl:stylesheet version="1.0"><!-- ETTN --></xsl:stylesheet>').toString("base64")}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    const xslt = gomuluXsltCikar(gonderenBelgesi);
    expect(xslt).toContain("<xsl:stylesheet");
    expect(xslt).toContain("ETTN");
  });

  it("görünüm yoksa, başka türde eklenti varsa ya da XML bozuksa null döner", () => {
    expect(gomuluXsltCikar(sarmala("<ID>A</ID>"))).toBeNull();
    // Yalnız DocumentTypeCode = XSLT olan eklenti görünümdür; sözleşme eki değil.
    const sozlesmeEki = sarmala(`<AdditionalDocumentReference>
      <DocumentTypeCode>SOZLESME</DocumentTypeCode>
      <Attachment><EmbeddedDocumentBinaryObject>${Buffer.from("<xsl:stylesheet/>").toString("base64")}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    expect(gomuluXsltCikar(sozlesmeEki)).toBeNull();
    expect(gomuluXsltCikar("<Invoice><unclosed>")).toBeNull();
  });

  it("türü DocumentType ile bildiren gönderenlerde de görünümü bulur", () => {
    // Gerçek gelen belgelerin neredeyse tamamı bu alanı kullanıyor.
    const ek = sarmala(`<AdditionalDocumentReference>
      <DocumentType>XSLT</DocumentType>
      <Attachment><EmbeddedDocumentBinaryObject>${Buffer.from('<xsl:stylesheet version="1.0"/>').toString("base64")}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    expect(gomuluXsltCikar(ek)).toContain("<xsl:stylesheet");
  });

  it("türü hiç yazılmamış ama .xslt dosyası olarak eklenmiş görünümü bulur", () => {
    // NES portalından gelen belgelerde eklentide yalnız ID, tarih ve dosya var.
    const icerik = Buffer.from('<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>').toString("base64");
    const ek = (dosyaAdi: string) => sarmala(`<AdditionalDocumentReference>
      <ID>35f3e909-eaa0-46d6-a252-a781b0e5c712</ID>
      <IssueDate>2026-09-10</IssueDate>
      <Attachment><EmbeddedDocumentBinaryObject filename="${dosyaAdi}" mimeCode="application/xml">${icerik}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    expect(gomuluXsltCikar(ek("35f3e909.xslt"))).toContain("<xsl:stylesheet");
    expect(gomuluXsltCikar(ek("GORUNUM.XSL"))).toContain("<xsl:stylesheet");
    // Türsüz eklenti dosya adı görünüm demiyorsa görünüm sayılmaz.
    expect(gomuluXsltCikar(ek("sozlesme.pdf"))).toBeNull();
  });

  it("XSLT'ye benzemeyen base64 içeriği görünüm sayılmaz", () => {
    const gorselEki = sarmala(`<AdditionalDocumentReference>
      <DocumentTypeCode>XSLT</DocumentTypeCode>
      <Attachment><EmbeddedDocumentBinaryObject>${Buffer.from("sadece düz metin").toString("base64")}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    expect(gomuluXsltCikar(gorselEki)).toBeNull();
  });
});

describe("giden belgeye görünüm gömülmez (2026-09-17 kararı)", () => {
  // Portal denemesinde entegratörün belgeyi kendi tasarımıyla bastığı görüldü;
  // gömülü görünüm okunmuyordu ve her faturaya ~80 KB ölü yük ekliyordu.
  it("kendi ürettiğimiz UBL'de XSLT eklentisi yoktur", () => {
    for (const tur of [undefined, "earsiv" as const]) {
      const xml = ubl(tur ? { tur } : undefined);
      expect(gomuluXsltCikar(xml)).toBeNull();
      expect(xml).not.toContain("<cbc:DocumentType>XSLT</cbc:DocumentType>");
      expect(xml).not.toContain("<xsl:stylesheet");
    }
  });

  it("e-Arşiv gönderim şekli eklentisi yerinde kalır", () => {
    // SEND_TYPE eklentisi görünümle ilgili değil; NES onu bekliyor.
    expect(ubl({ tur: "earsiv" })).toContain("<cbc:DocumentTypeCode>SEND_TYPE</cbc:DocumentTypeCode>");
  });

  it("belge kimliği ve karekod verisi UBL'de durmaya devam eder", () => {
    const xml = ubl();
    expect(xml).toContain("11111111-1111-4111-8111-111111111111");
    expect(xml).toContain("TKR2026000000001");
  });
});

describe("kendi kestiğimiz belgenin görünümü (2026-09-17)", () => {
  it("yedek görünüm notu yalnız gelen belgede yazılır", () => {
    const fatura = {
      profilId: "TICARIFATURA", belgeNo: "K072026000000049", tarih: "2026-09-17",
      dovizCinsi: "TRY", satirlar: [], toplamlar: {},
      gonderen: { unvan: "Satıcı A.Ş.", vknTckn: "9876543210" },
      alici: { unvan: "Alıcı A.Ş.", vknTckn: "1234567890" },
    } as never;
    expect(ebelgeYedekPdfHtml(fatura)).toContain(EBELGE_YEDEK_GORUNUM_NOTU);
    expect(ebelgeYedekPdfHtml(fatura, { kendiBelgemiz: true })).not.toContain(EBELGE_YEDEK_GORUNUM_NOTU);
  });
});

describe("dövizli belgenin TL karşılığı (EBLG-57)", () => {
  const dovizli = { ...(FATURA as object), dovizCinsi: "EUR", kur: 47.85 } as never;

  it("kur UBL'den okunur ve toplamların TL karşılığı basılır", () => {
    const fatura = faturaUblOku(faturaUblUret(dovizli, { unvan: "Satıcı A.Ş.", vkn: "9876543210" }));
    expect(fatura.kur).toBe(47.85);
    const html = ebelgeYedekPdfHtml(fatura, { kendiBelgemiz: true });
    expect(html).toContain("120,00 EUR");
    expect(html).toContain("47,8500 TL");
    expect(html).toContain("Ödenecek Tutar (TL)");
    expect(html).toContain("5.742,00 TL");
  });

  it("kuru olmayan belgede TL karşılığı uydurulmaz", () => {
    const fatura = faturaUblOku(faturaUblUret(dovizli, { unvan: "Satıcı A.Ş.", vkn: "9876543210" })
      .replace(/<cac:PricingExchangeRate>[\s\S]*?<\/cac:PricingExchangeRate>/, ""));
    expect(fatura.kur).toBeUndefined();
    expect(ebelgeYedekPdfHtml(fatura)).not.toContain("(TL)");
  });
});
