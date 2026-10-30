import { BadRequestException } from "@nestjs/common";
import { inflateSync } from "node:zlib";
import { clamavTara } from "./clamav";

/**
 * Yüklenen dosyanın içerik denetimi. Tarayıcının bildirdiği MIME türü
 * sahtelenebildiği için tür imza baytlarından belirlenir; uç yalnız kendi
 * profilindeki türleri kabul eder. Çalıştırılabilir dosya ve HTML her zaman
 * reddedilir; arşivlerde sıkıştırma bombası, makro ve tehlikeli adlar, PDF'te
 * otomatik çalışan eylemler, SVG'de betik aranır. ClamAV tanımlıysa ayrıca
 * taranır (bkz. clamav.ts).
 */

export type DosyaTuru =
  | "pdf" | "png" | "jpeg" | "gif" | "webp" | "svg"
  | "xlsx" | "docx" | "pptx" | "ofis_eski"
  | "metin" | "xml";

/**
 * Uç profilleri: hangi türler kabul edilir. Genel belge eki bugüne kadar kabul
 * edilen türlerle sınırlıdır; SVG (tarayıcıda açılınca betik çalışabilir),
 * GIF ve PPTX bilerek dışarıdadır.
 */
export const DOSYA_PROFILLERI = {
  /** Genel belge eki (ekler, personel belgesi). */
  belge: ["pdf", "png", "jpeg", "webp", "xlsx", "docx", "ofis_eski", "metin", "xml"],
  /** Çek/senet görüntüsü. */
  goruntu: ["png", "jpeg", "webp", "pdf"],
  /** Mutabakat yanıtı eki. */
  mutabakat: ["pdf", "xlsx", "ofis_eski", "metin"],
  /** Excel içe aktarma (cari, stok, puantaj). */
  excel: ["xlsx"],
  /** Banka ekstresi. */
  ekstre: ["metin", "xlsx", "xml", "pdf"],
  /** AI-79: asistan sohbetine eklenen fiş/fatura görseli, PDF ya da UBL XML. */
  sohbet: ["pdf", "png", "jpeg", "webp", "xml"],
} as const satisfies Record<string, readonly DosyaTuru[]>;
export type DosyaProfili = keyof typeof DOSYA_PROFILLERI;

const MIME: Record<DosyaTuru, string> = {
  pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ofis_eski: "application/vnd.ms-excel", metin: "text/plain", xml: "application/xml",
};
const UZANTILAR: Record<DosyaTuru, string[]> = {
  pdf: ["pdf"], png: ["png"], jpeg: ["jpg", "jpeg"], gif: ["gif"], webp: ["webp"], svg: ["svg"],
  xlsx: ["xlsx"], docx: ["docx"], pptx: ["pptx"], ofis_eski: ["xls", "doc", "ppt"],
  // KSB-32: MT940 dosyaları bankaya göre .sta, .mt940 ya da .940 uzantılı düz metindir.
  metin: ["txt", "csv", "sta", "mt940", "940"], xml: ["xml"],
};
const ESKI_OFIS_MIME: Record<string, string> = { xls: "application/vnd.ms-excel", doc: "application/msword", ppt: "application/vnd.ms-powerpoint" };
const TUR_ADI: Record<DosyaTuru, string> = {
  pdf: "PDF", png: "PNG", jpeg: "JPEG", gif: "GIF", webp: "WEBP", svg: "SVG", xlsx: "Excel (.xlsx)", docx: "Word (.docx)",
  pptx: "PowerPoint (.pptx)", ofis_eski: "eski Office (.xls/.doc)", metin: "metin/CSV", xml: "XML",
};

export class DosyaReddi extends BadRequestException {}
function red(neden: string): never { throw new DosyaReddi(`Dosya kabul edilmedi: ${neden}`); }

const basliyor = (b: Buffer, imza: number[], kayma = 0) => imza.every((x, i) => b[kayma + i] === x);
const ascii = (b: Buffer, bas: number, son: number) => b.subarray(bas, son).toString("latin1");

/** İmza baytlarından tür; tanınmayan ikili dosya `null`. */
export function turTespit(b: Buffer): DosyaTuru | "zip" | "calistirilabilir" | "html" | null {
  if (b.length === 0) return null;
  if (basliyor(b, [0x4d, 0x5a]) || basliyor(b, [0x7f, 0x45, 0x4c, 0x46]) || basliyor(b, [0xca, 0xfe, 0xba, 0xbe])
    || basliyor(b, [0xfe, 0xed, 0xfa, 0xce]) || basliyor(b, [0xcf, 0xfa, 0xed, 0xfe]) || basliyor(b, [0x23, 0x21])) return "calistirilabilir";
  if (ascii(b, 0, 1024).includes("%PDF-")) return "pdf";
  if (basliyor(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (basliyor(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (basliyor(b, [0x50, 0x4b, 0x03, 0x04]) || basliyor(b, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (basliyor(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ofis_eski";
  // Metin: sıfır bayt yok ve kontrol karakteri oranı düşük (Windows-1254 CSV de geçer).
  const ornek = b.subarray(0, 8192);
  if (ornek.includes(0)) return null;
  let kontrol = 0;
  for (const x of ornek) if (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0d && x !== 0x0c) kontrol++;
  if (kontrol / ornek.length > 0.01) return null;
  const bas = b.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (/<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>]|script[\s>]|iframe[\s>])/.test(bas)) return "html";
  if (bas.startsWith("<svg") || (bas.startsWith("<") && /<svg[\s>]/.test(bas))) return "svg";
  if (bas.startsWith("<")) return "xml";
  return "metin";
}

const TEHLIKELI_UZANTI = /\.(exe|dll|com|bat|cmd|msi|scr|pif|cpl|jar|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|sh|lnk|hta|reg|app|apk)$/i;
const ARSIV_SINIRI = { girdi: 5000, acikToplam: 200 * 1024 * 1024, oran: 200 };

/** ZIP merkezi dizinini okur (bağımlılıksız); Office türünü ve risk işaretlerini döndürür. */
export function zipIncele(b: Buffer): "xlsx" | "docx" | "pptx" {
  const ara = Math.max(0, b.length - 65557);
  let eocd = -1;
  for (let i = b.length - 22; i >= ara; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) red("arşiv yapısı okunamadı");
  const girdiSayisi = b.readUInt16LE(eocd + 10);
  const dizinBoyu = b.readUInt32LE(eocd + 12);
  const dizinBasi = b.readUInt32LE(eocd + 16);
  if (girdiSayisi === 0xffff || dizinBoyu === 0xffffffff || dizinBasi === 0xffffffff) red("ZIP64 arşivi desteklenmiyor");
  if (girdiSayisi > ARSIV_SINIRI.girdi) red("arşivde çok fazla dosya var");
  if (dizinBasi + dizinBoyu > b.length) red("arşiv yapısı bozuk");
  const adlar: string[] = [];
  let acikToplam = 0;
  for (let i = 0, p = dizinBasi; i < girdiSayisi; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) red("arşiv yapısı bozuk");
    const sikistirilmis = b.readUInt32LE(p + 20);
    const acik = b.readUInt32LE(p + 24);
    const adBoyu = b.readUInt16LE(p + 28);
    const ad = b.subarray(p + 46, p + 46 + adBoyu).toString("utf8");
    p += 46 + adBoyu + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    acikToplam += acik;
    if (acikToplam > ARSIV_SINIRI.acikToplam) red("arşiv açıldığında çok büyük (sıkıştırma bombası olabilir)");
    if (acik > 1024 * 1024 && sikistirilmis > 0 && acik / sikistirilmis > ARSIV_SINIRI.oran) red("arşivde olağan dışı sıkıştırma oranı var (sıkıştırma bombası olabilir)");
    if (ad.startsWith("/") || ad.includes("..") || ad.includes("\\")) red("arşivde güvensiz dosya yolu var");
    if (TEHLIKELI_UZANTI.test(ad)) red("arşivde çalıştırılabilir dosya var");
    if (/vbaProject\.bin$|\/activeX\//i.test(ad)) red("makro ya da ActiveX içeren Office belgesi kabul edilmez");
    adlar.push(ad);
  }
  if (!adlar.includes("[Content_Types].xml")) red("Office belgesi olmayan ZIP arşivi kabul edilmez");
  if (adlar.some((a) => a.startsWith("xl/"))) return "xlsx";
  if (adlar.some((a) => a.startsWith("word/"))) return "docx";
  if (adlar.some((a) => a.startsWith("ppt/"))) return "pptx";
  return red("tanınmayan Office belgesi");
}

/** PDF'te otomatik çalışabilen eylemler; sıkıştırılmış akışlar da açılarak aranır. */
export function pdfRiskli(b: Buffer): boolean {
  const desen = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia)(?![A-Za-z])/;
  const ham = b.toString("latin1");
  if (desen.test(ham)) return true;
  let acilan = 0;
  for (const m of ham.matchAll(/stream\r?\n/g)) {
    const bas = m.index! + m[0].length;
    const son = ham.indexOf("endstream", bas);
    if (son < 0) break;
    try {
      const icerik = inflateSync(b.subarray(bas, son), { maxOutputLength: 20 * 1024 * 1024 });
      acilan += icerik.length;
      if (desen.test(icerik.toString("latin1"))) return true;
    } catch { /* sıkıştırılmamış ya da başka filtre: atla */ }
    if (acilan > 100 * 1024 * 1024) return true; // açılım sınırı aşıldı: güvenli kabul edilmez
  }
  return false;
}

export function svgRiskli(b: Buffer): boolean {
  const s = b.toString("utf8");
  return /<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(s)
    || /(xlink:)?href\s*=\s*["'](?!#|data:image\/(png|jpeg|gif|webp);)/i.test(s);
}

const OLE_MAKRO = Buffer.from("_VBA_PROJECT", "utf16le");

export interface DenetimSonucu { tur: DosyaTuru; mime: string }

/** Profile göre içerik denetimi; ClamAV taraması bu fonksiyonun dışındadır (yuklemeDenetle). */
export function icerikDenetle(dosya: { buffer: Buffer; originalname?: string }, profil: DosyaProfili): DenetimSonucu {
  const b = dosya.buffer;
  if (!b?.length) red("dosya boş");
  const ham = turTespit(b);
  if (ham === "calistirilabilir") return red("çalıştırılabilir dosya yüklenemez");
  if (ham === "html") return red("HTML dosyası yüklenemez");
  if (ham === null) return red("dosya türü tanınmadı");
  const tur: DosyaTuru = ham === "zip" ? zipIncele(b) : ham;
  const izinli: readonly DosyaTuru[] = DOSYA_PROFILLERI[profil];
  if (!izinli.includes(tur)) red(`${TUR_ADI[tur]} bu alana yüklenemez; izin verilenler: ${izinli.map((t) => TUR_ADI[t]).join(", ")}`);

  const uzanti = (dosya.originalname ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (uzanti && !UZANTILAR[tur].includes(uzanti)) red(`dosya adı .${uzanti} ama içeriği ${TUR_ADI[tur]}`);

  if (tur === "ofis_eski" && b.includes(OLE_MAKRO)) red("makro içeren Office belgesi kabul edilmez");
  if (tur === "pdf" && pdfRiskli(b)) red("PDF otomatik çalışan içerik (JavaScript, Launch ya da gömülü dosya) barındırıyor");
  if (tur === "svg" && svgRiskli(b)) red("SVG betik ya da dış bağlantı barındırıyor");

  const mime = tur === "ofis_eski" ? ESKI_OFIS_MIME[uzanti ?? "xls"] ?? MIME.ofis_eski
    : tur === "metin" && uzanti === "csv" ? "text/csv" : MIME[tur];
  return { tur, mime };
}

/**
 * Uçlarda kullanılan tek giriş: içerik denetimi + (tanımlıysa) ClamAV.
 * Dosyanın `mimetype` alanı, saklanırken ve sunulurken güvenilsin diye
 * içerikten belirlenen türle değiştirilir.
 */
export async function yuklemeDenetle<T extends { buffer: Buffer; originalname?: string; mimetype?: string }>(dosya: T, profil: DosyaProfili): Promise<T & { mimetype: string }> {
  const { mime } = icerikDenetle(dosya, profil);
  const tarama = await clamavTara(dosya.buffer);
  if (tarama.durum === "zararli") red(`zararlı yazılım bulundu (${tarama.imza})`);
  if (tarama.durum === "hata") throw new DosyaReddi("Dosya kabul edilmedi: virüs taraması yapılamadı, biraz sonra tekrar deneyin.");
  return { ...dosya, mimetype: mime };
}
