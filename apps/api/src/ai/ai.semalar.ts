import { z } from "zod";

function ondalikSayi(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ""));
  return m ? Number(m[0].replace(",", ".")) : null;
}

function odemeSekliCoz(v: unknown): "nakit" | "kart" | "bilinmiyor" | null {
  if (typeof v !== "string") return null;
  const k = v.toLocaleLowerCase("tr-TR");
  if (/nakit|cash|peşin/.test(k)) return "nakit";
  if (/kart|kredi|card|pos|banka|visa|master|troy/.test(k)) return "kart";
  return "bilinmiyor";
}

/** "**** 1234", "1234", "5521 **** **** 1234" → "1234"; numara hiçbir zaman tam saklanmaz. */
function kartSonDortCoz(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const m = /(\d{4})\D*$/.exec(String(v).trim());
  return m ? m[1] : null;
}

/** Modeller güveni bazen yüzde yazar (95): 1–100 arası yüzdeye çevrilir; anlamsız değer düşük güven (0) sayılır. */
const guvenSkoruAlani = () => z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  const n = ondalikSayi(v);
  if (n === null) return 0;
  return n > 1 && n <= 100 ? n / 100 : n;
}, z.number().min(0).max(1).default(1)).catch(0);

/**
 * Fiş / Fatura OCR Çıkarım Şeması
 */
export const fisFaturaOcrSonucSemasi = z.object({
  belgeTuru: z.enum(["FIS", "FATURA", "E_ARSIV", "E_FATURA", "BILINMIYOR"]),
  belgeNo: z.string().optional().nullable(),
  tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalıdır").optional().nullable(),
  saticiUnvan: z.string().min(2, "Satıcı ünvanı en az 2 karakter olmalıdır"),
  saticiVknTckn: z.string().regex(/^\d{10,11}$/, "VKN 10 veya TCKN 11 haneli olmalıdır").optional().nullable(),
  saticiVergiDairesi: z.string().optional().nullable(),
  saticiAdres: z.string().optional().nullable(),
  saticiTelefon: z.string().optional().nullable(),
  saticiEposta: z.string().email().optional().nullable(),
  saticiIban: z.string().optional().nullable(),
  paraBirimi: z.string().default("TRY"),
  toplamKdv: z.number().min(0),
  toplamMatrah: z.number().min(0),
  genelToplam: z.number().min(0),
  kdvKirilimi: z.array(
    z.object({
      oran: z.number(),
      matrah: z.number(),
      kdvTutari: z.number(),
    })
  ).default([]),
  kalemler: z.array(
    z.object({
      aciklama: z.string(),
      miktar: z.number().default(1),
      birim: z.string().default("ADET"),
      birimFiyat: z.number().default(0),
      toplamTutar: z.number().default(0),
      kdvOrani: z.number().optional().nullable(),
    })
  ).default([]),
  guvenSkoru: guvenSkoruAlani(),
  // Ek alanlar (CNL-21/22) yardımcıdır: model biçimi tutturamazsa belge düşmez, alan boş kalır.
  /** CNL-21: fişte yazılıysa araç plakası (akaryakıt, otopark…); okunamazsa null. */
  plaka: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(20).nullable()).optional().catch(null),
  /** CNL-21: akaryakıt fişinde litre ("41,23" gibi metin de kabul edilir). */
  litre: z.preprocess(ondalikSayi, z.number().positive().max(100_000).nullable()).optional().catch(null),
  /** CNL-22: ödeme şekli ve kartla ödendiyse kartın son dört hanesi (tam numara okunmaz/saklanmaz). */
  odemeSekli: z.preprocess(odemeSekliCoz, z.enum(["nakit", "kart", "bilinmiyor"]).nullable()).optional().catch(null),
  kartSonDort: z.preprocess(kartSonDortCoz, z.string().regex(/^\d{4}$/).nullable()).optional().catch(null),
});

export type FisFaturaOcrSonuc = z.infer<typeof fisFaturaOcrSonucSemasi>;

/**
 * Kartvizit / İletişim Formu / E-posta Metninden Cari Çıkarım Şeması
 */
export const cariIletisimCikarimSemasi = z.object({
  unvan: z.string().min(2, "Ünvan veya kişi adı zorunludur"),
  kisiTipi: z.enum(["gercek", "tuzel"]).default("tuzel"),
  ad: z.string().optional().nullable(),
  soyad: z.string().optional().nullable(),
  vknTckn: z.string().regex(/^\d{10,11}$/).optional().nullable(),
  vergiDairesi: z.string().optional().nullable(),
  ticaretSicilNo: z.string().optional().nullable(),
  eposta: z.string().email().optional().nullable(),
  telefon: z.string().optional().nullable(),
  faks: z.string().optional().nullable(),
  webSitesi: z.string().optional().nullable(),
  adres: z.string().optional().nullable(),
  il: z.string().optional().nullable(),
  ilce: z.string().optional().nullable(),
  postaKodu: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  sektor: z.string().optional().nullable(),
  yetkiliKisi: z.object({
    adSoyad: z.string().optional().nullable(),
    unvan: z.string().optional().nullable(),
    telefon: z.string().optional().nullable(),
    eposta: z.string().email().optional().nullable(),
  }).optional().nullable(),
  guvenSkoru: guvenSkoruAlani(),
});

export type CariIletisimCikarim = z.infer<typeof cariIletisimCikarimSemasi>;

/**
 * OCR / Metin Tarama API Giriş Şeması
 */
export const aiBelgeGirdiSemasi = z.object({
  gorselBase64: z.string().max(10_000_000, "Dosya aktarım boyutu sınırı aşıldı").optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).default("image/jpeg"),
  hamMetin: z.string().max(100_000, "Belge metni en fazla 100.000 karakter olabilir").optional(),
  belgeTipi: z.enum(["fis_fatura", "cari_bilgisi", "otomatik"]).default("otomatik"),
});

export type AiBelgeGirdi = z.infer<typeof aiBelgeGirdiSemasi>;

export const OCR_AZAMI_DOSYA_BAYT = 6 * 1024 * 1024;
export const OCR_AZAMI_PDF_SAYFA = 10;
export const OCR_AZAMI_GORSEL_KENAR = 12_000;
export const OCR_AZAMI_GORSEL_PIKSEL = 40_000_000;

const MIME_IMZALARI: Record<Exclude<AiBelgeGirdi["mimeType"], undefined>, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  "application/pdf": (b) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-",
};

/**
 * Saklanan bir dosyadan (ör. e-posta eki) OCR girdisi: tür beyan edilen MIME'den değil dosyanın
 * imzasından belirlenir. Desteklenmeyen türde null döner.
 */
export function ocrGirdisiOlustur(dosya: Buffer): { gorselBase64: string; mimeType: NonNullable<AiBelgeGirdi["mimeType"]> } | null {
  const tur = (Object.keys(MIME_IMZALARI) as Array<NonNullable<AiBelgeGirdi["mimeType"]>>).find((m) => MIME_IMZALARI[m](dosya));
  return tur ? { gorselBase64: `data:${tur};base64,${dosya.toString("base64")}`, mimeType: tur } : null;
}

/** Beyan edilen MIME yerine dosyanın imzasını denetler; sağlayıcıya yalnız doğrulanmış veri gider. */
export interface OcrDosyaBilgisi {
  mimeType: AiBelgeGirdi["mimeType"];
  dosyaBayt: number;
  genislik: number | null;
  yukseklik: number | null;
}

export function ocrDosyasiniDogrula(girdi: AiBelgeGirdi): OcrDosyaBilgisi | null {
  if (!girdi.gorselBase64) return null;
  const eslesme = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(girdi.gorselBase64);
  if (!eslesme) throw new Error("Dosya geçerli bir base64 data URL biçiminde değil.");
  if (eslesme[1] !== girdi.mimeType) throw new Error("Dosyanın bildirilen türü ile içeriği uyuşmuyor.");

  const tampon = Buffer.from(eslesme[2], "base64");
  if (!tampon.length) throw new Error("Dosya boş olamaz.");
  if (tampon.length > OCR_AZAMI_DOSYA_BAYT) throw new Error("Dosya en fazla 6 MB olabilir.");
  if (!MIME_IMZALARI[girdi.mimeType](tampon)) throw new Error("Dosyanın gerçek türü desteklenmiyor veya bildirilen türle uyuşmuyor.");

  let boyut: { genislik: number; yukseklik: number } | null = null;
  if (girdi.mimeType === "application/pdf") {
    const metin = tampon.toString("latin1");
    const sayfaSayisi = metin.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
    if (sayfaSayisi > OCR_AZAMI_PDF_SAYFA) throw new Error(`PDF en fazla ${OCR_AZAMI_PDF_SAYFA} sayfa olabilir.`);
  } else {
    boyut = gorselBoyutlariniOku(tampon, girdi.mimeType);
    if (!boyut) throw new Error("Görsel boyutları doğrulanamadı.");
    if (boyut.genislik > OCR_AZAMI_GORSEL_KENAR || boyut.yukseklik > OCR_AZAMI_GORSEL_KENAR || boyut.genislik * boyut.yukseklik > OCR_AZAMI_GORSEL_PIKSEL) {
      throw new Error("Görsel en fazla 12.000 piksel kenar uzunluğunda ve 40 megapiksel olabilir.");
    }
  }
  return { mimeType: girdi.mimeType, dosyaBayt: tampon.length, genislik: boyut?.genislik ?? null, yukseklik: boyut?.yukseklik ?? null };
}

function gorselBoyutlariniOku(b: Buffer, mime: AiBelgeGirdi["mimeType"]): { genislik: number; yukseklik: number } | null {
  if (mime === "image/png" && b.length >= 24) return { genislik: b.readUInt32BE(16), yukseklik: b.readUInt32BE(20) };
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 4 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const uzunluk = b.readUInt16BE(i + 2);
      if (uzunluk < 2 || i + 2 + uzunluk > b.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { yukseklik: b.readUInt16BE(i + 5), genislik: b.readUInt16BE(i + 7) };
      }
      i += 2 + uzunluk;
    }
  }
  if (mime === "image/webp" && b.length >= 25) {
    const parca = b.subarray(12, 16).toString("ascii");
    if (parca === "VP8X" && b.length >= 30) return { genislik: 1 + b.readUIntLE(24, 3), yukseklik: 1 + b.readUIntLE(27, 3) };
    if (parca === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { genislik: b.readUInt16LE(26) & 0x3fff, yukseklik: b.readUInt16LE(28) & 0x3fff };
    }
    if (parca === "VP8L" && b[20] === 0x2f) {
      return {
        genislik: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        yukseklik: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    }
  }
  return null;
}
