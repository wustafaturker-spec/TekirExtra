/**
 * P1-9: kasa/banka hesap ekstresinin Excel çıktısı. Tutarlar sayı, tarihler
 * tarih olarak yazılır (süzülüp toplanabilsin); dövizli hesapta kur ve TL
 * karşılığı sütunları eklenir.
 */
import * as ExcelJS from "exceljs";
import type { HesapEkstresiVerisi } from "./hesap-ekstresi-pdf";

const PARA = "#,##0.00;[Red]-#,##0.00";
const KUR = "#,##0.0000";
const tarih = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const sayi = (deger: string | null) => (deger === null ? null : Number(deger));

export async function hesapEkstresiExcel(v: HesapEkstresiVerisi): Promise<Buffer> {
  const birim = v.hesap.dovizCinsi === "TRY" ? "TL" : v.hesap.dovizCinsi;
  const dovizli = v.hesap.dovizCinsi !== "TRY";
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "TekirExtra";
  const kolonlar = [
    { baslik: "Tarih", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Makbuz no", genislik: 16 },
    { baslik: "İşlem", genislik: 14 },
    { baslik: "Kaynak", genislik: 18 },
    { baslik: "Açıklama", genislik: 44 },
    { baslik: "Cari", genislik: 30 },
    { baslik: "Fatura", genislik: 18 },
    { baslik: "Karşı hesap", genislik: 20 },
    { baslik: `Giriş (${birim})`, genislik: 14, bicim: PARA },
    { baslik: `Çıkış (${birim})`, genislik: 14, bicim: PARA },
    ...(dovizli ? [{ baslik: "Kur", genislik: 10, bicim: KUR }, { baslik: "TL karşılığı", genislik: 14, bicim: PARA }] : []),
    { baslik: `Bakiye (${birim})`, genislik: 15, bicim: PARA },
  ];
  const sayfa = kitap.addWorksheet("Hesap ekstresi");
  sayfa.columns = kolonlar.map((k) => ({ width: k.genislik, style: k.bicim ? { numFmt: k.bicim } : {} }));
  const son = String.fromCharCode(64 + kolonlar.length);
  sayfa.mergeCells(`A1:${son}1`);
  sayfa.getCell("A1").value = `${v.hesap.tur === "kasa" ? "KASA" : "BANKA"} HESAP EKSTRESİ`;
  sayfa.getCell("A1").font = { size: 14, bold: true };
  const banka = v.hesap.banka;
  sayfa.getCell("A2").value = `${v.hesap.ad}${banka ? ` · ${banka.bankaAdi}${banka.iban ? ` · ${banka.iban}` : ""}` : ""} · ${birim}`;
  sayfa.getCell("A3").value = `Dönem: ${v.baslangic ?? "başlangıç"} – ${v.bitis ?? "bugün"} · Düzenlenme: ${new Date().toLocaleDateString("tr-TR")}`;
  sayfa.getCell("A3").font = { color: { argb: "FF6B7280" } };
  const baslik = sayfa.getRow(5);
  baslik.values = kolonlar.map((k) => k.baslik);
  baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
  baslik.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
  sayfa.views = [{ state: "frozen", ySplit: 5 }];
  sayfa.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: kolonlar.length } };

  if (v.baslangic) {
    sayfa.addRow([tarih(v.baslangic), null, "Devir", null, "Dönem başı bakiyesi", null, null, null, null, null, ...(dovizli ? [null, sayi(v.devirTry)] : []), sayi(v.devir)]).font = { bold: true };
  }
  for (const s of v.satirlar) {
    const r = sayfa.addRow([
      tarih(s.tarih), s.makbuzNo, s.islem, s.kaynak, s.aciklama, s.cari, s.belge, s.karsiHesap,
      sayi(s.giris), sayi(s.cikis),
      ...(dovizli ? [sayi(s.kur), sayi(s.tutarTry)] : []),
      sayi(s.bakiye),
    ]);
    if (s.kaynakTur === "acilis") r.font = { bold: true };
  }
  const toplam = sayfa.addRow([null, null, null, null, "Dönem toplamı", null, null, null, sayi(v.giris), sayi(v.cikis), ...(dovizli ? [null, Number(v.girisTry) - Number(v.cikisTry)] : []), sayi(v.donemSonu)]);
  toplam.font = { bold: true };
  toplam.eachCell((c) => { c.border = { top: { style: "medium" } }; });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}
