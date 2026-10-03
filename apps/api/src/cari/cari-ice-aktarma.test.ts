import * as ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { excelSatirlariniOku, sablonOlustur, sayiCoz, tarihCoz, tipCoz, yonCoz } from "./cari-ice-aktarma";

async function dosya(satirlar: unknown[][]) {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Cariler");
  satirlar.forEach((s, i) => { sayfa.getRow(i + 1).values = s as ExcelJS.CellValue[]; });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

describe("cari Excel içe aktarma çözümleyicisi (CARI-31)", () => {
  it("sütunları başlığa göre okur; sıra ve takma adlar önemsizdir, boş hücre yazılmaz", async () => {
    const satirlar = await excelSatirlariniOku(await dosya([
      ["Ünvan", "Vergi No", "Cari Kodu", "E-posta", "Açılış bakiyesi"],
      ["A Ltd.", 1234567890, "C1", { text: "a@b.com", hyperlink: "mailto:a@b.com" }, 1500.5],
      ["B A.Ş.", null, "C2", null, null],
      [null, null, null, null, null],
    ]));
    expect(satirlar).toEqual([
      { satir: 2, hucreler: { unvan: "A Ltd.", vknTckn: "1234567890", kod: "C1", eposta: "a@b.com", acilisTutari: "1500.5" } },
      { satir: 3, hucreler: { unvan: "B A.Ş.", kod: "C2" } },
    ]);
  });

  it("başlığı tanınmayan eski 6 sütunlu dosyayı konumuna göre okur", async () => {
    const satirlar = await excelSatirlariniOku(await dosya([["a", "b", "c", "d", "e", "f"], ["K1", "Müşteri", "tedarikçi", "1234567890", "x@y.com", "555"]]));
    expect(satirlar[0].hucreler).toEqual({ kod: "K1", unvan: "Müşteri", tip: "tedarikçi", vknTckn: "1234567890", eposta: "x@y.com", telefon: "555" });
  });

  it("şablon kendi başlıklarıyla geri okunur", async () => {
    const satirlar = await excelSatirlariniOku(await sablonOlustur());
    expect(satirlar[0].hucreler).toMatchObject({ kod: "MUS-010", tip: "Müşteri", kisiTipi: "Tüzel", riskLimiti: "100000", etiketler: "Bayi, VIP" });
  });

  it("değer çözümleyicileri Türkçe yazımları kabul eder", () => {
    expect(tipCoz("Her İkisi")).toEqual({ deger: "her_ikisi" });
    expect(tipCoz("TEDARİKÇİ")).toEqual({ deger: "tedarikci" });
    expect(tipCoz("bayi")).toHaveProperty("hata");
    expect(sayiCoz("1.234,56", "Tutar")).toEqual({ deger: 1234.56 });
    expect(sayiCoz("1234.56", "Tutar")).toEqual({ deger: 1234.56 });
    expect(sayiCoz("120", "İskonto %", 0, 100)).toHaveProperty("hata");
    expect(tarihCoz("1.9.2026", "Tarih")).toEqual({ deger: "2026-09-01" });
    expect(tarihCoz("31.02.2026", "Tarih")).toHaveProperty("hata");
    expect(yonCoz("Alacak")).toEqual({ deger: "alacak" });
  });
});
