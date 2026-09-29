/**
 * CARI-24/25/26: cari ekstresinin Excel çıktısı. Tutarlar sayı, tarihler
 * tarih olarak yazılır (süzülüp toplanabilsin); ayrıntılı ekstrede kalemler
 * faturanın altında gruplanır (Excel'de açılıp kapanır), döviz ekstresinde
 * her döviz ayrı sayfadadır.
 */
import * as ExcelJS from "exceljs";
import { bakiyeYonu, EKSTRE_TURU_ADLARI } from "@tekirextra/shared";
import type { EkstreVerisi } from "./cari-ekstre-pdf";

const PARA = "#,##0.00;[Red]-#,##0.00";
const KUR = "#,##0.0000";
const MIKTAR = "#,##0.###";
const tarih = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const sayi = (deger: string | number | null | undefined) => (deger === null || deger === undefined || deger === "" ? null : Number(deger));

interface Kolon { baslik: string; genislik: number; bicim?: string }

function sayfaKur(kitap: ExcelJS.Workbook, ad: string, v: EkstreVerisi, altBaslik: string, kolonlar: Kolon[]): ExcelJS.Worksheet {
  const sayfa = kitap.addWorksheet(ad.slice(0, 31));
  sayfa.columns = kolonlar.map((k) => ({ width: k.genislik, style: k.bicim ? { numFmt: k.bicim } : {} }));
  const son = String.fromCharCode(64 + kolonlar.length);
  sayfa.mergeCells(`A1:${son}1`);
  sayfa.getCell("A1").value = "CARİ HESAP EKSTRESİ";
  sayfa.getCell("A1").font = { size: 14, bold: true };
  sayfa.getCell("A2").value = `${v.cari.unvan} (${v.cari.kod})${v.cari.vknTckn ? ` · VKN/TCKN ${v.cari.vknTckn}` : ""}`;
  sayfa.getCell("A3").value = `${altBaslik} · Dönem: ${v.baslangic ?? "başlangıç"} – ${v.bitis ?? "bugün"} · Düzenlenme: ${new Date().toLocaleDateString("tr-TR")}`;
  sayfa.getCell("A3").font = { color: { argb: "FF6B7280" } };
  const baslik = sayfa.getRow(5);
  baslik.values = kolonlar.map((k) => k.baslik);
  baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
  baslik.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
  sayfa.views = [{ state: "frozen", ySplit: 5 }];
  sayfa.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: kolonlar.length } };
  sayfa.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  return sayfa;
}

function toplamSatiri(sayfa: ExcelJS.Worksheet, degerler: (string | number | null)[]) {
  const r = sayfa.addRow(degerler);
  r.font = { bold: true };
  r.eachCell((c) => { c.border = { top: { style: "medium" } }; });
}

function tlSayfasi(kitap: ExcelJS.Workbook, v: EkstreVerisi) {
  const ayrintili = v.tur === "ayrintili";
  const kolonlar: Kolon[] = [
    { baslik: "Tarih", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Vade", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Hareket", genislik: 15 },
    { baslik: "Belge No", genislik: 18 },
    { baslik: "Açıklama", genislik: 44 },
    { baslik: "Ödeme", genislik: 26 },
    ...(ayrintili ? [{ baslik: "Miktar", genislik: 11, bicim: MIKTAR }, { baslik: "Birim", genislik: 8 }, { baslik: "Birim fiyat", genislik: 12, bicim: "#,##0.00##" }, { baslik: "Kalem tutarı", genislik: 14, bicim: PARA }] : []),
    { baslik: "Döviz tutarı", genislik: 13, bicim: PARA },
    { baslik: "Döviz", genislik: 7 },
    { baslik: "Kur", genislik: 10, bicim: KUR },
    { baslik: "Borç (TL)", genislik: 14, bicim: PARA },
    { baslik: "Alacak (TL)", genislik: 14, bicim: PARA },
    { baslik: "Bakiye (TL)", genislik: 15, bicim: PARA },
    { baslik: "B/A", genislik: 5 },
  ];
  const sayfa = sayfaKur(kitap, "Ekstre", v, EKSTRE_TURU_ADLARI[v.tur], kolonlar);
  const kalemBos = ayrintili ? [null, null, null, null] : [];
  if (v.baslangic) {
    const devir = Number(v.devirBakiyesi);
    const r = sayfa.addRow([tarih(v.baslangic), null, "Devir", null, "Devir bakiyesi", null, ...kalemBos, null, null, null, devir > 0 ? devir : null, devir < 0 ? -devir : null, devir, bakiyeYonu(devir)]);
    r.font = { bold: true };
  }
  for (const s of v.satirlar) {
    const r = sayfa.addRow([
      tarih(s.tarih), s.vadeTarihi ? tarih(s.vadeTarihi) : null, s.hareketTuru, s.belgeNo, `${s.aciklama ?? ""}${s.iptal ? " (iptal)" : ""}`, s.odemeSekli,
      ...kalemBos,
      s.dovizCinsi !== "TRY" ? sayi(s.tutar) : null, s.dovizCinsi !== "TRY" ? s.dovizCinsi : null, s.dovizCinsi !== "TRY" ? sayi(s.kur) : null,
      s.tip === "borc" ? sayi(s.tutarTry) : null, s.tip === "alacak" ? sayi(s.tutarTry) : null, sayi(s.yuruyenBakiye), bakiyeYonu(s.yuruyenBakiye),
    ]);
    if (s.iptal) r.font = { color: { argb: "FF9CA3AF" }, strike: true };
    if (ayrintili && s.fatura) {
      for (const k of s.fatura.kalemler) {
        const kr = sayfa.addRow([null, null, null, null, `${k.stokKod} · ${k.stokAd}${Number(k.iskontoOrani) > 0 ? ` (isk. %${k.iskontoOrani})` : ""}`, null, sayi(k.miktar), k.birim, sayi(k.birimFiyat), sayi(k.tutar), null, s.fatura.dovizCinsi !== "TRY" ? s.fatura.dovizCinsi : null]);
        kr.outlineLevel = 1;
        kr.font = { color: { argb: "FF4B5563" } };
      }
    }
  }
  toplamSatiri(sayfa, [null, null, null, null, "Dönem toplamı", null, ...kalemBos, null, null, null, sayi(v.donemBorc), sayi(v.donemAlacak), sayi(v.donemSonuBakiyesi), bakiyeYonu(v.donemSonuBakiyesi)]);
}

function dovizSayfalari(kitap: ExcelJS.Workbook, v: EkstreVerisi) {
  const kolonlar = (birim: string): Kolon[] => [
    { baslik: "Tarih", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Vade", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Hareket", genislik: 15 },
    { baslik: "Belge No", genislik: 18 },
    { baslik: "Açıklama", genislik: 44 },
    { baslik: "Ödeme", genislik: 26 },
    { baslik: `Borç (${birim})`, genislik: 14, bicim: PARA },
    { baslik: `Alacak (${birim})`, genislik: 14, bicim: PARA },
    { baslik: "Kur", genislik: 10, bicim: KUR },
    { baslik: "TL karşılığı", genislik: 14, bicim: PARA },
    { baslik: `Bakiye (${birim})`, genislik: 15, bicim: PARA },
    { baslik: "B/A", genislik: 5 },
  ];
  for (const b of v.dovizBolumleri ?? []) {
    const birim = b.dovizCinsi === "TRY" ? "TL" : b.dovizCinsi;
    const sayfa = sayfaKur(kitap, `${birim} hesabı`, v, `${EKSTRE_TURU_ADLARI.doviz} · ${birim}`, kolonlar(birim));
    if (v.baslangic) sayfa.addRow([tarih(v.baslangic), null, "Devir", null, "Devir bakiyesi", null, null, null, null, null, sayi(b.devir), bakiyeYonu(b.devir)]).font = { bold: true };
    for (const s of b.satirlar) {
      sayfa.addRow([tarih(s.tarih), s.vadeTarihi ? tarih(s.vadeTarihi) : null, s.hareketTuru, s.belgeNo, `${s.aciklama ?? ""}${s.iptal ? " (iptal)" : ""}`, s.odemeSekli,
        s.tip === "borc" ? sayi(s.tutar) : null, s.tip === "alacak" ? sayi(s.tutar) : null, b.dovizCinsi === "TRY" ? null : sayi(s.kur), sayi(s.tutarTry), sayi(s.yuruyenDovizBakiye), bakiyeYonu(s.yuruyenDovizBakiye)]);
    }
    toplamSatiri(sayfa, [null, null, null, null, `${birim} dönem toplamı`, null, sayi(b.borc), sayi(b.alacak), null, null, sayi(b.bakiye), bakiyeYonu(b.bakiye)]);
  }
}

function cevrilmisSayfa(kitap: ExcelJS.Workbook, v: EkstreVerisi) {
  const c = v.cevrilmis!;
  const birim = c.dovizCinsi;
  const sayfa = sayfaKur(kitap, `${birim} cinsinden`, v, `${EKSTRE_TURU_ADLARI.doviz} · ${birim} cinsinden`, [
    { baslik: "Tarih", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Vade", genislik: 11, bicim: "dd.mm.yyyy" },
    { baslik: "Hareket", genislik: 15 },
    { baslik: "Belge No", genislik: 18 },
    { baslik: "Açıklama", genislik: 44 },
    { baslik: "Hareket tutarı", genislik: 14, bicim: PARA },
    { baslik: "Hareket dövizi", genislik: 9 },
    { baslik: "Çevrim kuru", genislik: 11, bicim: KUR },
    { baslik: `Borç (${birim})`, genislik: 14, bicim: PARA },
    { baslik: `Alacak (${birim})`, genislik: 14, bicim: PARA },
    { baslik: `Bakiye (${birim})`, genislik: 15, bicim: PARA },
    { baslik: "B/A", genislik: 5 },
  ]);
  if (v.baslangic) sayfa.addRow([tarih(v.baslangic), null, "Devir", null, "Devir bakiyesi", null, null, null, null, null, sayi(c.devir), bakiyeYonu(c.devir)]).font = { bold: true };
  for (const s of c.satirlar) {
    sayfa.addRow([tarih(s.tarih), s.vadeTarihi ? tarih(s.vadeTarihi) : null, s.hareketTuru, s.belgeNo, `${s.aciklama ?? ""}${s.iptal ? " (iptal)" : ""}`,
      sayi(s.tutar), s.dovizCinsi === "TRY" ? "TL" : s.dovizCinsi, sayi(s.cevrimKuru), s.tip === "borc" ? sayi(s.hedefTutar) : null, s.tip === "alacak" ? sayi(s.hedefTutar) : null, sayi(s.yuruyenDovizBakiye), bakiyeYonu(s.yuruyenDovizBakiye)]);
  }
  toplamSatiri(sayfa, [null, null, null, null, "Dönem toplamı", null, null, null, sayi(c.borc), sayi(c.alacak), sayi(c.bakiye), bakiyeYonu(c.bakiye)]);
}

export async function ekstreExcelYaz(v: EkstreVerisi): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  kitap.creator = "TekirExtra";
  if (v.tur === "doviz") {
    if (v.cevrilmis) cevrilmisSayfa(kitap, v); else dovizSayfalari(kitap, v);
    if (kitap.worksheets.length === 0) tlSayfasi(kitap, { ...v, tur: "standart" });
  } else {
    tlSayfasi(kitap, v);
  }
  return Buffer.from(await kitap.xlsx.writeBuffer());
}
