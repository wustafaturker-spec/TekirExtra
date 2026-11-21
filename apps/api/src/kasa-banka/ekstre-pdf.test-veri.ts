/**
 * KSB-34 testleri için en küçük PDF üretici: Helvetica ile konumlu yazılar.
 * Gerçek banka ekstreleri kişisel veri taşıdığı için repoya konmaz; testler
 * bankaların düzenlerini (tek satır, üstte açıklama, ortalanmış çok satır)
 * bu üreticiyle taklit eder. Konumlar sol üst köşeden (pdf.js'in tersine).
 */
import { pdfSatirlari } from "./ekstre-pdf";

/**
 * pdf.js kütüphanesini ve sahte işçisini bir kez yükler. Tam test koşusunda bu ilk yükleme
 * CPU yarışında onlarca saniye sürebiliyor; `beforeAll` içinde çağrılınca testin süresine yazılmaz.
 */
export async function pdfjsIsit(): Promise<void> {
  await pdfSatirlari(pdfUret([[{ x: 30, y: 60, metin: "isitma" }]]));
}

export interface Yazi { x: number; y: number; metin: string; boyut?: number }

export function pdfUret(sayfalar: Yazi[][], secenek: { genislik?: number; yukseklik?: number } = {}): Buffer {
  const g = secenek.genislik ?? 595;
  const h = secenek.yukseklik ?? 842;
  const nesneler: string[] = [];
  const ekle = (govde: string) => nesneler.push(govde) ;
  ekle("<< /Type /Catalog /Pages 2 0 R >>");
  ekle(""); // sayfalar sonra
  ekle("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const sayfaNolari: number[] = [];
  for (const yazilar of sayfalar) {
    const kacis = (m: string) => m.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const akis = yazilar.map((y) => `BT /F1 ${y.boyut ?? 8} Tf ${y.x} ${h - y.y} Td (${kacis(y.metin)}) Tj ET`).join("\n");
    ekle(`<< /Length ${Buffer.byteLength(akis, "latin1")} >>\nstream\n${akis}\nendstream`);
    const icerik = nesneler.length;
    ekle(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${g} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${icerik} 0 R >>`);
    sayfaNolari.push(nesneler.length);
  }
  nesneler[1] = `<< /Type /Pages /Kids [${sayfaNolari.map((n) => `${n} 0 R`).join(" ")}] /Count ${sayfaNolari.length} >>`;
  let pdf = "%PDF-1.4\n";
  const konumlar: number[] = [];
  nesneler.forEach((n, i) => { konumlar.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${n}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n${konumlar.map((k) => `${String(k).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Sağa yaslı tutar: sağ kenarı `sag` olacak şekilde yaklaşık x (Helvetica rakam genişliği 0,556 em). */
export const sagaYasla = (metin: string, sag: number, boyut = 8) => sag - metin.length * 0.556 * boyut;
