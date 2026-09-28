import * as ExcelJS from "exceljs";
import { birimCoz } from "@tekirextra/shared";

// ─── CARİ EXCEL OKUYUCU (CARI-07) ──────────────────────────────────────────

export async function cariExcelOku(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Çalışma sayfası bulunamadı");

  const cariler: any[] = [];
  worksheet.eachRow((row, rowNumber) => {
    // Başlık satırını atla
    if (rowNumber === 1) return;

    const kod = row.getCell(1).value?.toString()?.trim();
    const unvan = row.getCell(2).value?.toString()?.trim();
    const tipRaw = row.getCell(3).value?.toString()?.trim()?.toLowerCase();
    const vknTckn = row.getCell(4).value?.toString()?.trim();
    const eposta = row.getCell(5).value?.toString()?.trim();
    const telefon = row.getCell(6).value?.toString()?.trim();

    if (unvan) {
      let tip = "musteri";
      if (tipRaw === "tedarikci" || tipRaw === "tedarikçi") tip = "tedarikci";
      else if (tipRaw === "diger" || tipRaw === "diğer") tip = "diger";

      cariler.push({
        kod: kod || `CARİ-${Date.now()}-${rowNumber}`,
        unvan,
        tip,
        vknTckn: vknTckn || null,
        eposta: eposta || null,
        telefon: telefon || null,
      });
    }
  });

  return cariler;
}

// ─── STOK EXCEL OKUYUCU (STK-05) ───────────────────────────────────────────

export async function stokExcelOku(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Çalışma sayfası bulunamadı");

  const urunler: any[] = [];
  worksheet.eachRow((row, rowNumber) => {
    // Başlık satırını atla
    if (rowNumber === 1) return;

    const kod = row.getCell(1).value?.toString()?.trim();
    const ad = row.getCell(2).value?.toString()?.trim();
    const tipRaw = row.getCell(3).value?.toString()?.trim()?.toLowerCase();
    const barkod = row.getCell(4).value?.toString()?.trim();
    const kdvOraniRaw = row.getCell(5).value;
    const alisFiyatiRaw = row.getCell(6).value;
    const satisFiyatiRaw = row.getCell(7).value;
    // STK-01: birim sütunu boşsa kart "adet" açılır; tanınmayan yazım satır
    // numarasıyla birlikte geri bildirilir.
    const birimHam = row.getCell(8).value?.toString()?.trim() || null;

    if (ad) {
      let tip = "urun";
      if (tipRaw === "hizmet") tip = "hizmet";

      const kdvOrani = kdvOraniRaw ? Number(kdvOraniRaw) : 20;
      const alisFiyati = alisFiyatiRaw ? Number(alisFiyatiRaw) : null;
      const satisFiyati = satisFiyatiRaw ? Number(satisFiyatiRaw) : null;

      urunler.push({
        kod: kod || `STK-${Date.now()}-${rowNumber}`,
        ad,
        tip,
        barkod: barkod || null,
        kdvOrani,
        alisFiyati,
        satisFiyati,
        satirNo: rowNumber,
        birimHam,
        birim: birimCoz(birimHam),
      });
    }
  });

  return urunler;
}

export async function stokExcelSablonYaz(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stok Şablonu");
  sheet.columns = [
    { header: "Kod", key: "kod", width: 18 }, { header: "Ad", key: "ad", width: 32 },
    { header: "Tip", key: "tip", width: 14 }, { header: "Barkod", key: "barkod", width: 20 },
    { header: "KDV Oranı", key: "kdv", width: 14 }, { header: "Alış Fiyatı", key: "alis", width: 16 },
    { header: "Satış Fiyatı", key: "satis", width: 16 }, { header: "Birim", key: "birim", width: 12 },
  ];
  sheet.addRow({ kod: "STK-001", ad: "Örnek Ürün", tip: "urun", barkod: "8690000000001", kdv: 20, alis: 100, satis: 150, birim: "adet" });
  sheet.addRow({ kod: "STK-002", ad: "Örnek Kablo", tip: "urun", kdv: 20, alis: 12, satis: 18, birim: "metre" });
  sheet.addRow({ kod: "HIZ-001", ad: "Örnek Hizmet", tip: "hizmet", kdv: 20, satis: 500, birim: "saat" });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  sheet.autoFilter = "A1:H1";
  const bilgi = workbook.addWorksheet("Açıklamalar");
  bilgi.addRows([["Alan", "Açıklama"], ["Kod", "Mevcut kod güncellenir."], ["Ad", "Zorunlu."], ["Tip", "urun veya hizmet"], ["KDV Oranı", "Boşsa 20."], ["Fiyatlar", "Boş bırakılabilir."], ["Birim", "adet, kg, gram, ton, litre, ml, metre, cm, mm, km, m2, m3, paket, kutu, koli, çift, set, düzine, rulo, çuval, palet, şişe, varil, saat, gün, ay, yıl, kwh. Boşsa adet. Hareketi olan ürünün birimi değiştirilemez."]]);
  bilgi.getRow(1).font = { bold: true }; bilgi.columns = [{ width: 18 }, { width: 60 }];
  return (await workbook.xlsx.writeBuffer()) as any;
}

// ─── CARİ EKSTRE EXCEL YAZICI (CARI-04) ────────────────────────────────────

export async function cariEkstreExcelYaz(
  cari: { unvan: string; kod: string },
  hareketler: {
    tarih: Date;
    aciklama: string;
    borc: string;
    alacak: string;
    bakiye: string;
  }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Cari Ekstre");

  // Stil ayarları
  worksheet.views = [{ showGridLines: true }];

  // Üst Başlıklar
  worksheet.mergeCells("A1:E1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "TEKİREXTRA CARİ HESAP EKSTRESİ";
  titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "6D28D9" }, // Violet primary color
  };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 40;

  // Cari Bilgileri
  worksheet.getCell("A3").value = "Cari Kod:";
  worksheet.getCell("A3").font = { bold: true };
  worksheet.getCell("B3").value = cari.kod;

  worksheet.getCell("A4").value = "Cari Ünvan:";
  worksheet.getCell("A4").font = { bold: true };
  worksheet.getCell("B4").value = cari.unvan;

  worksheet.getCell("D3").value = "Rapor Tarihi:";
  worksheet.getCell("D3").font = { bold: true };
  worksheet.getCell("E3").value = new Date().toLocaleDateString("tr-TR");

  // Tablo Başlıkları
  const headers = ["Tarih", "Açıklama", "Borç (Giriş)", "Alacak (Çıkış)", "Bakiye"];
  worksheet.getRow(6).values = headers;
  worksheet.getRow(6).font = { bold: true, color: { argb: "FFFFFF" } };
  worksheet.getRow(6).height = 25;
  
  for (let col = 1; col <= 5; col++) {
    const cell = worksheet.getCell(6, col);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1E1B4B" }, // dark indigo header
    };
    cell.alignment = { vertical: "middle", horizontal: col === 1 ? "center" : "left" };
  }

  // Veri satırları
  let rowIdx = 7;
  hareketler.forEach((h) => {
    const row = worksheet.getRow(rowIdx);
    row.getCell(1).value = h.tarih;
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(2).value = h.aciklama;
    
    row.getCell(3).value = h.borc !== "" ? Number(h.borc) : null;
    row.getCell(3).numFmt = "#,##0.00";
    
    row.getCell(4).value = h.alacak !== "" ? Number(h.alacak) : null;
    row.getCell(4).numFmt = "#,##0.00";
    
    row.getCell(5).value = Number(h.bakiye);
    row.getCell(5).numFmt = "#,##0.00";

    // Hizalama
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "right" };
    row.getCell(4).alignment = { horizontal: "right" };
    row.getCell(5).alignment = { horizontal: "right" };

    rowIdx++;
  });

  // Otomatik sütun genişliği ayarlama
  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 0;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });
    column.width = Math.min(maxLength + 3, 50);
  });

  return (await workbook.xlsx.writeBuffer()) as any;
}
