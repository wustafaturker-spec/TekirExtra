import * as ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { maliyetEksigiListesi, maliyetEksigiSorgusu } from "./maliyet-eksikleri";
import { maliyetEksikleriExcelYaz } from "./maliyet-eksikleri-excel";
import type { SatisSatiri } from "../stok/satis-ozeti";

const D = (v: string | number) => new Prisma.Decimal(v);
const kaynak: SatisSatiri[] = Array.from({ length: 103 }, (_, i) => ({
  faturaSatirId: `s${i}`, faturaId: `f${i}`, faturaNo: i === 0 ? "=1+1" : `SAT${i}`,
  tarih: new Date("2026-10-15"), cariId: "c", cariKod: "C", cariUnvan: "=HYPERLINK(\"x\")",
  tip: "satis", stokId: "11111111-1111-4111-8111-111111111111", kod: "+ÜRÜN", ad: "@Test",
  stokTip: "urun", miktar: D("1.125"), ciro: D("0.10"), maliyet: D(0), mevcutMiktar: D(-1), hareketPaylari: [],
}));
const q = maliyetEksigiSorgusu({ baslangic: "2026-10-01", bitis: "2026-10-15", sayfa: 3, sayfaBoyutu: 50, neden: "hareket_yok", stokId: kaynak[0].stokId });

async function oku(veri = maliyetEksigiListesi(kaynak, q, "tum")) {
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(await maliyetEksikleriExcelYaz(veri, q, "=Firma", new Date("2026-10-15T09:00:00Z")) as never);
  return w;
}

describe("maliyet kontrolü Excel", () => {
  it("varyant kimliğini listeyle aynı kod ve adla metin olarak aktarır", async () => {
    const w = await oku(maliyetEksigiListesi([{ ...kaynak[0], varyantId: "v1", varyantKod: "=MAVI", varyantAd: "Mavi · XL" }], q, "tum"));
    const s = w.getWorksheet("Satışlar")!;
    expect(s.getCell("N2").value).toBe("=MAVI");
    expect(s.getCell("N2").type).toBe(ExcelJS.ValueType.String);
    expect(s.getCell("O2").value).toBe("Mavi · XL");
  });
  it("son sayfadan da tüm filtreli satırları aktarır; özet ve kaynak kimlikleri eşleşir", async () => {
    expect(maliyetEksigiListesi(kaynak, q).satirlar).toHaveLength(3);
    const w = await oku(), s = w.getWorksheet("Satışlar")!, o = w.getWorksheet("Özet")!;
    expect(s.rowCount).toBe(104);
    expect(s.getCell("K104").value).toBe("s102");
    expect(s.getCell("F2").value).toBe(1.125);
    expect(s.getCell("G2").value).toBe(0.1);
    expect(s.getCell("I2").value).toBe("İlişkili stok hareketi yok");
    expect(o.getCell("B3").value).toBe("2026-10-01");
    expect(o.getCell("B5").value).toBe("2026-10-15T09:00:00.000Z");
    expect(o.getCell("B6").value).toContain(kaynak[0].stokId);
    expect(o.getCell("B10").value).toBe(103);
    expect(o.getCell("B11").value).toBe(10.3);
  });
  it("metin hücreleri formül olarak çalışmaz", async () => {
    const w = await oku(), s = w.getWorksheet("Satışlar")!;
    for (const [adres, deger] of [["B2", "=1+1"], ["C2", '=HYPERLINK("x")'], ["D2", "+ÜRÜN"], ["E2", "@Test"]]) {
      expect(s.getCell(adres).type).toBe(ExcelJS.ValueType.String);
      expect(s.getCell(adres).value).toBe(deger);
    }
    expect(w.getWorksheet("Özet")!.getCell("B2").value).toBe("=Firma");
  });
  it("Excel hassasiyetini aşan parasal toplam tam metin olarak korunur", async () => {
    const veri = maliyetEksigiListesi(kaynak, q, "tum");
    veri.donemOzeti.ciro = "199999999999999800.01";
    veri.filtreOzeti.ciro = veri.donemOzeti.ciro;
    veri.satirlar[0].ciro = "123456789012345.67";
    const w = await oku(veri);
    expect(w.getWorksheet("Özet")!.getCell("B11").value).toBe("199999999999999800.01");
    expect(w.getWorksheet("Satışlar")!.getCell("G2").value).toBe("123456789012345.67");
  });
  it("boş filtrede başlıklı ve sıfır özetli geçerli dosya üretir", async () => {
    const w = await oku(maliyetEksigiListesi([], q, "tum"));
    expect(w.getWorksheet("Satışlar")!.rowCount).toBe(1);
    expect(w.getWorksheet("Özet")!.getCell("B10").value).toBe(0);
    expect(w.getWorksheet("Özet")!.getCell("B11").value).toBe(0);
  });
});
