import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { SAYFA_STILI } from "../core/pdf/pdf-sablon";
import { gomuluXsltCikar } from "./ubl-gorunum";
import { faturaUblUret } from "./xml-uretec";

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
  it("kendi ürettiğimiz UBL'den görünümü çıkarır", () => {
    const xslt = gomuluXsltCikar(ubl());
    expect(xslt).toContain("<xsl:stylesheet");
    expect(xslt).toContain("ETTN");
  });

  it("e-Arşiv belgesinde de görünüm bulunur", () => {
    expect(gomuluXsltCikar(ubl({ tur: "earsiv" }))).toContain("<xsl:stylesheet");
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

  it("XSLT'ye benzemeyen base64 içeriği görünüm sayılmaz", () => {
    const gorselEki = sarmala(`<AdditionalDocumentReference>
      <DocumentTypeCode>XSLT</DocumentTypeCode>
      <Attachment><EmbeddedDocumentBinaryObject>${Buffer.from("sadece düz metin").toString("base64")}</EmbeddedDocumentBinaryObject></Attachment>
    </AdditionalDocumentReference>`);
    expect(gomuluXsltCikar(gorselEki)).toBeNull();
  });
});

describe("gömülü görünüm ile PDF çıktısı (EBLG-31)", () => {
  const xslt = gomuluXsltCikar(ubl())!;

  it("geçerli XML'dir ve XSLT 1.0 bildirir", () => {
    const ayristirici = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });
    const kok = ayristirici.parse(xslt) as Record<string, Record<string, unknown>>;
    expect(kok.stylesheet["@_version"]).toBe("1.0");
  });

  it("PDF ile aynı sayfa stilini taşır", () => {
    expect(xslt).toContain(SAYFA_STILI.trim().slice(0, 120));
  });

  it("PDF ile aynı sütun başlıklarını ve toplam etiketlerini kullanır", () => {
    for (const baslik of ["Ürün / Hizmet", "Birim Fiyat", "KDV %", "Matrah"]) {
      expect(xslt).toContain(baslik);
    }
    for (const etiket of ["Brüt Toplam", "KDV Matrahı", "Hesaplanan KDV", "Genel Toplam"]) {
      expect(xslt).toContain(etiket);
    }
  });

  it("belge kimliğini gösterir: ETTN, senaryo ve profil", () => {
    expect(xslt).toContain("ETTN");
    expect(xslt).toContain("Senaryo");
    expect(xslt).toContain("Profil");
  });
});
