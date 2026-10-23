import * as ExcelJS from "exceljs";
import { kacis, paraBicim, sayfaSablonu, tarihBicim } from "../core/pdf/pdf-sablon";
import type { BelgeTemasi } from "../core/pdf/belge-temasi";
import { AMORTISMAN_LISTESI } from "./amortisman-listesi";
import { DEMIRBAS_SINIFLARI } from "./demirbas.semalar";

type Sayi = { toString(): string } | number | null | undefined;
const n = (v: Sayi) => (v == null ? null : Number(v.toString()));

function basliklariBicimle(sayfa: ExcelJS.Worksheet) {
  sayfa.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sayfa.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
  sayfa.views = [{ state: "frozen", ySplit: 1 }];
}

/** DMR-12: tek sayfalık rapor; sütunlar {baslik, anahtar, genislik, para?}. */
export async function raporExcel(ad: string, sutunlar: { baslik: string; anahtar: string; genislik?: number; para?: boolean }[], satirlar: Record<string, unknown>[], toplamlar?: Record<string, Sayi>): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet(ad.slice(0, 31));
  sayfa.columns = sutunlar.map((s) => ({ header: s.baslik, key: s.anahtar, width: s.genislik ?? 16, style: s.para ? { numFmt: "#,##0.00" } : {} }));
  for (const s of satirlar) sayfa.addRow(Object.fromEntries(sutunlar.map((c) => [c.anahtar, c.para ? n(s[c.anahtar] as Sayi) : s[c.anahtar] ?? ""])));
  if (toplamlar) {
    const r = sayfa.addRow(Object.fromEntries(sutunlar.map((c, i) => [c.anahtar, i === 0 ? "TOPLAM" : c.anahtar in toplamlar ? n(toplamlar[c.anahtar]) : ""])));
    r.font = { bold: true };
  }
  basliklariBicimle(sayfa);
  sayfa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sutunlar.length } };
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

// ─── Açılış şablonu ve okuyucu (DMR-11) ───────────────────────────────────

export const ACILIS_SUTUNLARI = [
  { anahtar: "kod", baslik: "Kod", aciklama: "Boşsa DMR-000001 sırasıyla verilir." },
  { anahtar: "ad", baslik: "Ad", aciklama: "Zorunlu." },
  { anahtar: "sinif", baslik: "Sınıf", aciklama: `Zorunlu: ${DEMIRBAS_SINIFLARI.join(", ")}` },
  { anahtar: "listeKodu", baslik: "Liste no", aciklama: "VUK amortisman listesi sıra no (ör. 4.1); 'Amortisman listesi' sayfasına bakın. Boş bırakılabilir." },
  { anahtar: "faydaliOmur", baslik: "Faydalı ömür (yıl)", aciklama: "Zorunlu; boşsa liste no'nun ömrü kullanılır." },
  { anahtar: "yontem", baslik: "Yöntem", aciklama: "normal ya da azalan (yalnız bilanço esası). Boşsa normal." },
  { anahtar: "edinmeTarihi", baslik: "Edinme tarihi", aciklama: "Zorunlu (GG.AA.YYYY ya da tarih hücresi)." },
  { anahtar: "edinmeBedeli", baslik: "Bedel (TL)", aciklama: "Zorunlu; amortismana esas bedel." },
  { anahtar: "acilisBirikmis", baslik: "Birikmiş amortisman (TL)", aciklama: "Bugüne kadar ayrılmış toplam; boşsa 0." },
  { anahtar: "acilisSonYil", baslik: "Birikmişin son yılı", aciklama: "Birikmiş varsa zorunlu (ör. 2025): o yıla kadar ayrıldı." },
  { anahtar: "binekOto", baslik: "Binek oto (E/H)", aciklama: "E ise ilk yıl kıst ve GVK 40/5 sınırı uygulanır." },
  { anahtar: "binekVergili", baslik: "ÖTV/KDV maliyette ya da ikinci el (E/H)", aciklama: "Binek otoda yüksek sınır." },
  { anahtar: "seriNo", baslik: "Seri no", aciklama: "" },
  { anahtar: "konum", baslik: "Konum", aciklama: "" },
  { anahtar: "aciklama", baslik: "Açıklama", aciklama: "" },
] as const;

export async function acilisSablonu(): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Demirbaşlar");
  sayfa.columns = ACILIS_SUTUNLARI.map((s) => ({ header: s.baslik, key: s.anahtar, width: Math.max(14, s.baslik.length + 2) }));
  sayfa.addRow({ kod: "", ad: "Dizüstü bilgisayar", sinif: "demirbas", listeKodu: "4.1", faydaliOmur: 4, yontem: "normal", edinmeTarihi: "15.03.2024", edinmeBedeli: 42000, acilisBirikmis: 21000, acilisSonYil: 2025, binekOto: "H", binekVergili: "H", seriNo: "SN123", konum: "Merkez ofis", aciklama: "" });
  sayfa.addRow({ kod: "", ad: "Şirket aracı", sinif: "tasit", listeKodu: "6.1", faydaliOmur: 5, yontem: "normal", edinmeTarihi: "10.07.2025", edinmeBedeli: 1250000, acilisBirikmis: 125000, acilisSonYil: 2025, binekOto: "E", binekVergili: "H", seriNo: "34 ABC 123", konum: "", aciklama: "" });
  basliklariBicimle(sayfa);
  const bilgi = kitap.addWorksheet("Açıklamalar");
  bilgi.columns = [{ header: "Sütun", key: "s", width: 34 }, { header: "Açıklama", key: "a", width: 90 }];
  for (const s of ACILIS_SUTUNLARI) bilgi.addRow({ s: s.baslik, a: s.aciklama });
  bilgi.addRow({ s: "", a: "Açılış kartları muhasebe aktarımına girmez (DMR-11). Hatalı satır varsa dosyadaki hiçbir kart yazılmaz." });
  bilgi.getRow(1).font = { bold: true };
  const liste = kitap.addWorksheet("Amortisman listesi");
  liste.columns = [{ header: "Liste no", key: "kod", width: 10 }, { header: "Kıymet", key: "ad", width: 70 }, { header: "Ömür", key: "omur", width: 8 }, { header: "Sınıf", key: "sinif", width: 14 }];
  for (const k of AMORTISMAN_LISTESI) liste.addRow(k);
  basliklariBicimle(liste);
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

export interface AcilisSatiri {
  satirNo: number;
  kod?: string; ad: string; sinif: string; listeKodu?: string; faydaliOmur?: number; yontem: string;
  edinmeTarihi?: string; edinmeBedeli?: number; acilisBirikmis: number; acilisSonYil?: number;
  binekOto: boolean; binekVergili: boolean; seriNo?: string; konum?: string; aciklama?: string;
}

function hucreMetni(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in v) return hucreMetni(v.result as ExcelJS.CellValue);
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v).trim();
}

function tarihCoz(m: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m;
  const t = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(m);
  return t ? `${t[3]}-${t[2].padStart(2, "0")}-${t[1].padStart(2, "0")}` : undefined;
}

function sayiCoz(m: string): number | undefined {
  if (!m) return undefined;
  // "1.250.000,50" ya da "1250000.50"
  const s = m.includes(",") ? m.replace(/\./g, "").replace(",", ".") : m;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** Ham satırları okur; alan doğrulaması servisin şemasındadır. */
export async function acilisOku(buffer: Buffer): Promise<AcilisSatiri[]> {
  const kitap = new ExcelJS.Workbook();
  await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
  const sayfa = kitap.worksheets[0];
  if (!sayfa) throw new Error("Çalışma sayfası bulunamadı");
  const satirlar: AcilisSatiri[] = [];
  sayfa.eachRow((row, no) => {
    if (no === 1) return;
    const h = Object.fromEntries(ACILIS_SUTUNLARI.map((s, i) => [s.anahtar, hucreMetni(row.getCell(i + 1).value)])) as Record<(typeof ACILIS_SUTUNLARI)[number]["anahtar"], string>;
    if (!Object.values(h).some(Boolean)) return;
    const evet = (m: string) => /^(e|evet|x|1|true)$/i.test(m);
    satirlar.push({
      satirNo: no, kod: h.kod || undefined, ad: h.ad, sinif: h.sinif.toLocaleLowerCase("tr"), listeKodu: h.listeKodu || undefined,
      faydaliOmur: sayiCoz(h.faydaliOmur), yontem: (h.yontem || "normal").toLocaleLowerCase("tr"),
      edinmeTarihi: tarihCoz(h.edinmeTarihi), edinmeBedeli: sayiCoz(h.edinmeBedeli), acilisBirikmis: sayiCoz(h.acilisBirikmis) ?? 0,
      acilisSonYil: sayiCoz(h.acilisSonYil), binekOto: evet(h.binekOto), binekVergili: evet(h.binekVergili),
      seriNo: h.seriNo || undefined, konum: h.konum || undefined, aciklama: h.aciklama || undefined,
    });
  });
  return satirlar;
}

// ─── Zimmet tutanağı (DMR-10) ─────────────────────────────────────────────

export function zimmetTutanagiHtml(v: {
  firma: string;
  zimmet: { baslangic: string; bitis: string | null; konum: string | null; aciklama: string | null; demirbas: { kod: string; ad: string; seriNo: string | null; edinmeBedeli: Sayi } };
  personel: { ad: string; soyad: string; personelNo: string; unvan: string | null } | null;
}, tema?: BelgeTemasi): string {
  const z = v.zimmet;
  const kisi = v.personel ? `${v.personel.ad} ${v.personel.soyad} (${v.personel.personelNo})${v.personel.unvan ? ` — ${v.personel.unvan}` : ""}` : "—";
  const icerik = `
  <style>
    table.zt { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
    table.zt th, table.zt td { border: 1px solid #d4d4d8; padding: 6px 8px; text-align: left; }
    table.zt th { background: #f4f4f5; width: 34%; }
    .imzalar { display: flex; justify-content: space-between; margin-top: 56px; font-size: 11px; }
    .imzalar div { width: 40%; border-top: 1px solid #52525b; padding-top: 6px; text-align: center; }
    p.metin { font-size: 11px; line-height: 1.6; }
  </style>
  <table class="zt">
    <tr><th>Demirbaş</th><td>${kacis(z.demirbas.kod)} — ${kacis(z.demirbas.ad)}</td></tr>
    <tr><th>Seri no</th><td>${kacis(z.demirbas.seriNo ?? "—")}</td></tr>
    <tr><th>Edinme bedeli</th><td>${kacis(paraBicim(String(z.demirbas.edinmeBedeli ?? 0)))} TL</td></tr>
    <tr><th>Teslim alan</th><td>${kacis(kisi)}</td></tr>
    <tr><th>Konum</th><td>${kacis(z.konum ?? "—")}</td></tr>
    <tr><th>Teslim tarihi</th><td>${kacis(tarihBicim(z.baslangic))}</td></tr>
    ${z.bitis ? `<tr><th>İade tarihi</th><td>${kacis(tarihBicim(z.bitis))}</td></tr>` : ""}
    ${z.aciklama ? `<tr><th>Açıklama</th><td>${kacis(z.aciklama)}</td></tr>` : ""}
  </table>
  <p class="metin">Yukarıda bilgileri yazılı demirbaşı sağlam ve çalışır durumda teslim aldım. Görevim süresince özenle kullanacağımı,
  kaybı ya da kusurlu kullanım nedeniyle oluşacak zarardan sorumlu olduğumu ve görevimden ayrılırken eksiksiz iade edeceğimi kabul ederim.</p>
  <div class="imzalar"><div>Teslim eden<br>${kacis(v.firma)}</div><div>Teslim alan<br>${kacis(kisi)}</div></div>`;
  return sayfaSablonu({ baslik: "DEMİRBAŞ ZİMMET TUTANAĞI", altBaslik: v.firma, icerik, tema });
}
