import * as ExcelJS from "exceljs";
import type { RaporSatiri, RaporTanimi } from "./rapor-kayit";

/**
 * Ortak rapor Excel yazıcısı (RPR-04/06): kolon tanımlarından başlık ve
 * sayı biçimlerini üretir; tüm raporlar aynı görsel dille dışa aktarılır.
 */
export async function raporExcelYaz(
  tanim: RaporTanimi,
  satirlar: RaporSatiri[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sayfa = workbook.addWorksheet(tanim.ad.slice(0, 31));

  const sonKolon = String.fromCharCode(64 + Math.min(tanim.kolonlar.length, 26));
  sayfa.mergeCells(`A1:${sonKolon}1`);
  const baslik = sayfa.getCell("A1");
  baslik.value = `TEKİREXTRA — ${tanim.ad.toUpperCase()}`;
  baslik.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFF" } };
  baslik.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "6D28D9" } };
  baslik.alignment = { horizontal: "center", vertical: "middle" };
  sayfa.getRow(1).height = 32;

  sayfa.getCell("A2").value = `Rapor tarihi: ${new Date().toLocaleDateString("tr-TR")}`;
  sayfa.getCell("A2").font = { size: 9, color: { argb: "6B7280" } };

  const baslikSatiri = sayfa.getRow(4);
  baslikSatiri.values = tanim.kolonlar.map((k) => k.baslik);
  baslikSatiri.font = { bold: true, color: { argb: "FFFFFF" } };
  baslikSatiri.height = 22;
  for (let i = 1; i <= tanim.kolonlar.length; i++) {
    baslikSatiri.getCell(i).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1E1B4B" },
    };
  }

  let satirNo = 5;
  for (const satir of satirlar) {
    const excelSatiri = sayfa.getRow(satirNo);
    tanim.kolonlar.forEach((k, i) => {
      const hucre = excelSatiri.getCell(i + 1);
      const deger = satir[k.alan];
      switch (k.tip) {
        case "para":
          hucre.value = deger === null || deger === undefined ? null : Number(deger);
          hucre.numFmt = "#,##0.00";
          hucre.alignment = { horizontal: "right" };
          break;
        case "sayi":
          hucre.value = deger === null || deger === undefined ? null : Number(deger);
          hucre.numFmt = "#,##0.###";
          hucre.alignment = { horizontal: "right" };
          break;
        case "yuzde":
          hucre.value = deger === null || deger === undefined ? null : Number(deger) / 100;
          hucre.numFmt = "0.00%";
          hucre.alignment = { horizontal: "right" };
          break;
        case "tarih":
          hucre.value = typeof deger === "string" && deger ? new Date(deger) : null;
          hucre.numFmt = "yyyy-mm-dd";
          hucre.alignment = { horizontal: "center" };
          break;
        default:
          hucre.value = deger === null || deger === undefined ? "" : String(deger);
      }
    });
    satirNo++;
  }

  sayfa.columns.forEach((kolon) => {
    let enGenis = 12;
    kolon.eachCell?.({ includeEmpty: false }, (hucre) => {
      const uzunluk = hucre.value ? hucre.value.toString().length : 0;
      if (uzunluk > enGenis) enGenis = uzunluk;
    });
    kolon.width = Math.min(enGenis + 3, 50);
  });

  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
