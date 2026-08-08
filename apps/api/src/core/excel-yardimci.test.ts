import { describe, expect, it } from "vitest";
import * as ExcelJS from "exceljs";
import { cariExcelOku, stokExcelOku, cariEkstreExcelYaz, stokExcelSablonYaz } from "./excel-yardimci";

describe("ExcelYardimci (CARI-04/07, STK-05)", () => {
  it("cariExcelOku excel belgesindeki cari satirlarini okur (CARI-07)", async () => {
    // Mock excel oluştur
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Cariler");
    sheet.getRow(1).values = ["Kod", "Ünvan", "Tip", "VKN/TCKN", "E-posta", "Telefon"];
    sheet.getRow(2).values = ["C1", "Müşteri A", "musteri", "123456", "a@b.com", "555"];
    sheet.getRow(3).values = ["C2", "Tedarikçi B", "tedarikçi", "789012", "c@d.com", "444"];

    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    const sonuc = await cariExcelOku(buffer);

    expect(sonuc.length).toBe(2);
    expect(sonuc[0].kod).toBe("C1");
    expect(sonuc[0].unvan).toBe("Müşteri A");
    expect(sonuc[0].tip).toBe("musteri");
    expect(sonuc[1].tip).toBe("tedarikci");
  });

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

  it("cariEkstreExcelYaz cari ekstre verilerini excel tablosuna yazar (CARI-04)", async () => {
    const cari = { kod: "C01", unvan: "Test Müşterisi" };
    const hareketler = [
      {
        tarih: new Date("2026-07-01"),
        aciklama: "Devir borç",
        borc: "100.00",
        alacak: "",
        bakiye: "100.00",
      },
    ];

    const buffer = await cariEkstreExcelYaz(cari, hareketler);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
