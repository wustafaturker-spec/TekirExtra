import { describe, expect, it } from "vitest";
import * as ExcelJS from "exceljs";
import { stokExcelOku, stokExcelSablonYaz } from "./excel-yardimci";

describe("ExcelYardimci (STK-05)", () => {
  it("stokExcelOku excel belgesindeki urun satirlarini okur (STK-05)", async () => {
    // Mock excel oluştur
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ürünler");
    sheet.getRow(1).values = ["Kod", "Ad", "Tip", "Barkod", "KDV Oranı", "Alış Fiyatı", "Satış Fiyatı"];
    sheet.getRow(2).values = ["U1", "Ürün A", "urun", "BAR1", 20, 10.5, 15.0];
    sheet.getRow(3).values = ["U2", "Hizmet B", "hizmet", "", 18, 0, 50.0];

    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    const sonuc = await stokExcelOku(buffer);

    expect(sonuc.length).toBe(2);
    expect(sonuc[0].kod).toBe("U1");
    expect(sonuc[0].ad).toBe("Ürün A");
    expect(sonuc[0].tip).toBe("urun");
    expect(sonuc[1].tip).toBe("hizmet");
    expect(sonuc[1].kdvOrani).toBe(18);
  });

  it("stok icin indirilebilir ornek sablon olusturur", async () => {
    const buffer = await stokExcelSablonYaz();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    expect(workbook.getWorksheet("Stok Şablonu")?.getCell("A1").value).toBe("Kod");
    expect(workbook.getWorksheet("Stok Şablonu")?.getCell("A2").value).toBe("STK-001");
    expect(workbook.getWorksheet("Açıklamalar")).toBeDefined();
  });


});
