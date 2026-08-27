import { BadRequestException } from "@nestjs/common";

const MIME_GRUPLARI: Record<string, (icerik: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": zipMi,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": zipMi,
  "application/vnd.ms-excel": oleMi,
  "application/msword": oleMi,
  "text/plain": metinMi,
  "text/csv": metinMi,
  "application/xml": xmlMi,
  "text/xml": xmlMi,
};

export const IZINLI_DOSYA_MIMELERI = new Set(Object.keys(MIME_GRUPLARI));

function zipMi(b: Buffer): boolean {
  if (b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) return false;
  return (b[2] === 0x03 && b[3] === 0x04)
    || (b[2] === 0x05 && b[3] === 0x06)
    || (b[2] === 0x07 && b[3] === 0x08);
}

function oleMi(b: Buffer): boolean {
  return b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

function metinMi(b: Buffer): boolean {
  if (!b.length || b.includes(0)) return false;
  return !b.toString("utf8").includes("\uFFFD");
}

function xmlMi(b: Buffer): boolean {
  if (!metinMi(b)) return false;
  const baslangic = b.toString("utf8", 0, Math.min(b.length, 512)).replace(/^\uFEFF/, "").trimStart();
  return baslangic.startsWith("<?xml") || /^<[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(baslangic);
}

export function dosyaIceriginiDogrula(dosya: { mimetype: string; buffer: Buffer }): void {
  const dogrulayici = MIME_GRUPLARI[dosya.mimetype];
  if (!dogrulayici) {
    throw new BadRequestException(`'${dosya.mimetype}' türü desteklenmiyor (PDF, görsel, Office ve metin dosyaları yüklenebilir)`);
  }
  if (!dogrulayici(dosya.buffer)) {
    throw new BadRequestException("Dosya içeriği bildirilen dosya türüyle uyuşmuyor");
  }
}

export interface YuklemeDosyasi {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}

export function excelDosyasiniDogrula(dosya: YuklemeDosyasi): void {
  if (!dosya.originalname.toLocaleLowerCase("tr-TR").endsWith(".xlsx")) {
    throw new BadRequestException("Yalnızca .xlsx biçiminde Excel dosyası yüklenebilir");
  }
  if (!zipMi(dosya.buffer)) {
    throw new BadRequestException("Excel dosyasının içeriği geçerli bir XLSX belgesi değil");
  }
}

export function ekstreDosyasiniDogrula(dosya: YuklemeDosyasi): void {
  const uzanti = dosya.originalname.toLocaleLowerCase("tr-TR");
  if (!uzanti.endsWith(".csv") && !uzanti.endsWith(".txt")) {
    throw new BadRequestException("Banka ekstresi yalnızca .csv veya .txt biçiminde yüklenebilir");
  }
  if (!metinMi(dosya.buffer)) {
    throw new BadRequestException("Banka ekstresi geçerli bir metin/CSV dosyası değil");
  }
}
