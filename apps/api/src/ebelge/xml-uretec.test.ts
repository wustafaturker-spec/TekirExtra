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
});
