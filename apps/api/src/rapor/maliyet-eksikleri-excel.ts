import * as ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import type { maliyetEksigiListesi, maliyetEksigiSorgusu } from "./maliyet-eksikleri";

/** Excel'in 15 basamak sınırını aşan sayılar tam metin olarak korunur. */
function sayi(v: string): number | string {
  const d = new Prisma.Decimal(v), n = Number(v);
  return Number.isFinite(n) && d.toSignificantDigits(15).eq(d) && new Prisma.Decimal(n).eq(d) ? n : v;
}

export async function maliyetEksikleriExcelYaz(
  veri: ReturnType<typeof maliyetEksigiListesi>,
  q: ReturnType<typeof maliyetEksigiSorgusu>,
  firma: string,
  alindigiZaman = new Date(),
): Promise<Buffer> {
  const w = new ExcelJS.Workbook();
  w.creator = "TekirExtra";
  const o = w.addWorksheet("Özet");
  const bilgiler: [string, string | number][] = [
    ["Rapor", "Satış maliyet kontrolü"], ["Firma", firma], ["Başlangıç", veri.baslangic], ["Bitiş", veri.bitis],
    ["Alınma zamanı (UTC)", alindigiZaman.toISOString()],
    ["Ürün filtresi", q.stokId ? `${veri.satirlar[0]?.kod ?? "Seçili ürün"} · ${q.stokId}` : "Tüm ürünler"],
    ["Kayıt bulgusu", q.neden === "hepsi" ? "Tümü" : q.neden === "hareket_yok" ? "İlişkili stok hareketi yok" : "Hareket var, kayıtlı maliyet sıfır"],
    ["Dönemde kontrol edilecek satır", veri.donemOzeti.satir], ["Dönemde ilgili ciro (TRY)", sayi(veri.donemOzeti.ciro)],
    ["Filtredeki satır", veri.filtreOzeti.satir], ["Filtrede ilgili ciro (TRY)", sayi(veri.filtreOzeti.ciro)],
    ["Kapsam", "Seçili filtrelere uyan tüm satırlar; ekran sayfalaması uygulanmaz."],
    ["Kaynak", "Dosya oluşturulurken kaynak yeniden okunur; ekrandaki tutarlar arada değişmiş olabilir."],
    ["Yorum", "Sıfır maliyet tek başına eksik maliyet kanıtı değildir; bedelsiz edinim olabilir."],
    ["Ciro", "İlgili ciro, eksik maliyet tutarı veya düzeltilecek kâr değildir."],
    ["Stok", "Güncel eksi stok, satış tarihindeki stok durumunu göstermez."],
    ["Sayılar", "Excel'in 15 basamak sınırını aşan değerler doğruluğu korumak için metindir. Miktarlar ana birimdedir."],
  ];
  bilgiler.forEach((b) => o.addRow(b));
  o.getColumn(1).width = 34; o.getColumn(2).width = 110;
  o.getColumn(1).font = { bold: true };
  o.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  for (const no of [9, 11]) o.getCell(no, 2).numFmt = '#,##0.00 "TRY"';

  const s = w.addWorksheet("Satışlar", { views: [{ state: "frozen", ySplit: 1 }] });
  s.columns = [
    { header: "Tarih", width: 14 }, { header: "Fatura No", width: 24 }, { header: "Cari", width: 36 },
    { header: "Ürün Kodu", width: 22 }, { header: "Ürün", width: 36 }, { header: "Miktar (ana birim)", width: 22 },
    { header: "Ciro (TRY)", width: 22 }, { header: "Kayıtlı Maliyet (TRY)", width: 24 },
    { header: "Kayıt Bulgusu", width: 44 }, { header: "Güncel Stok Eksi", width: 22 },
    { header: "Kaynak Satır ID", width: 38 }, { header: "Fatura ID", width: 38 }, { header: "Ürün ID", width: 38 },
    { header: "Varyant Kodu", width: 24 }, { header: "Varyant", width: 36 },
  ];
  for (const r of veri.satirlar) s.addRow([
    r.tarih, r.faturaNo, r.cariUnvan, r.kod, r.ad, sayi(r.miktar), sayi(r.ciro), sayi(r.maliyet),
    r.neden === "hareket_yok" ? "İlişkili stok hareketi yok" : "Hareket var, kayıtlı maliyet sıfır",
    r.guncelStokEksi ? "Evet" : "Hayır", r.id, r.faturaId, r.stokId, r.varyantKod ?? "", r.varyantAd ?? "",
  ]);
  s.getRow(1).font = { bold: true };
  s.autoFilter = { from: "A1", to: `O${Math.max(1, s.rowCount)}` };
  s.getColumn(6).numFmt = "#,##0.######";
  for (const c of [7, 8]) s.getColumn(c).numFmt = '#,##0.00 "TRY"';
  return Buffer.from(await w.xlsx.writeBuffer());
}
