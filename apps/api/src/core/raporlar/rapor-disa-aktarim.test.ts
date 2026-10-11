import * as ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { toplamSatiri } from "./rapor-disa-aktarim";
import { raporExcelYaz } from "./rapor-excel";
import { raporPdfHtml } from "./rapor-pdf";
import type { RaporKolon, RaporTanimi } from "./rapor-kayit";

const kolonlar: RaporKolon[] = [
  { alan: "ad", baslik: "Ad", tip: "metin" },
  { alan: "tarih", baslik: "Tarih", tip: "tarih" },
  { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "doviz", toplam: true },
  { alan: "tl", baslik: "TL", tip: "para", toplam: true },
  { alan: "bakiye", baslik: "Bakiye", tip: "para" },
];
const tanim = { kod: "t.t", modul: "genel", ad: "Deneme", filtreler: [], kolonlar, calistir: async () => [] } as RaporTanimi;
const bilgi = { firma: "ACME A.Ş.", bilgiler: ["Dönem: 01.10.2026 – 11.10.2026", "Cari: C1 · Alıcı"], vurguRengi: "#ea580c" };

describe("dışa aktarım (RPR-16)", () => {
  it("toplam ekrandaki kuralla: aynı dövizde toplanır, karışıkta toplanmaz, işaretsiz sütun yok", () => {
    const tek = toplamSatiri(kolonlar, [{ tutar: 10, doviz: "USD", tl: 400 }, { tutar: 5.5, doviz: "USD", tl: 220 }])!;
    expect(tek.get("tutar")).toEqual({ deger: 15.5, doviz: "USD" });
    expect(tek.get("tl")).toEqual({ deger: 620 });
    expect(tek.has("bakiye")).toBe(false);
    expect(toplamSatiri(kolonlar, [{ tutar: 1, doviz: "USD" }, { tutar: 1, doviz: "EUR" }])!.get("tutar")).toBe("karisik");
    expect(toplamSatiri(kolonlar, [{ tutar: 1 }])).toBeNull();
  });

  it("Excel: firma başlığı, dönem/süzgeç satırları, dövizli biçim, gg.aa.yyyy ve toplam", async () => {
    const buf = await raporExcelYaz(tanim, [
      { ad: "a", tarih: "2026-10-01", tutar: 10, doviz: "EUR", tl: 350 },
      { ad: "b", tarih: "2026-10-02", tutar: 2, doviz: "EUR", tl: 70 },
    ], bilgi);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const s = wb.worksheets[0];
    expect(s.getCell("A1").value).toBe("ACME A.Ş. — Deneme");
    expect(s.getCell("A2").value).toBe(bilgi.bilgiler[0]);
    expect(s.getCell("A3").value).toBe(bilgi.bilgiler[1]);
    expect(s.getRow(6).getCell(1).value).toBe("Ad");
    expect(s.getRow(7).getCell(2).numFmt).toBe("dd.mm.yyyy");
    expect(s.getRow(7).getCell(3).numFmt).toBe('#,##0.00 "EUR"');
    expect(s.getRow(9).getCell(1).value).toBe("Toplam");
    expect(s.getRow(9).getCell(3).value).toBe(12);
    expect(s.getRow(9).getCell(4).value).toBe(420);
  });

  it("26'dan fazla sütunda başlık birleşir", async () => {
    const genis = { ...tanim, kolonlar: Array.from({ length: 30 }, (_, i) => ({ alan: `k${i}`, baslik: `K${i}`, tip: "metin" as const })) };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await raporExcelYaz(genis, []));
    expect(wb.worksheets[0].getCell("AD1").isMerged).toBe(true);
  });

  it("PDF: süzgeç özeti, birimli dövizli hücre ve toplam satırı", () => {
    const html = raporPdfHtml(tanim, [{ ad: "a", tutar: 10, doviz: "USD", tl: 400 }, { ad: "b", tutar: 1, doviz: "USD", tl: 40 }], undefined, bilgi);
    expect(html).toContain("Cari: C1 · Alıcı");
    expect(html).toContain("ACME A.Ş.");
    expect(html).toContain("10,00 USD");
    expect(html).toContain("<tfoot>");
    expect(html).toContain("11,00 USD");
  });
});
