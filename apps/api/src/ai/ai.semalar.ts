import { z } from "zod";

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
  guvenSkoru: z.number().min(0).max(1).default(1),
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
  guvenSkoru: z.number().min(0).max(1).default(1),
});

export type CariIletisimCikarim = z.infer<typeof cariIletisimCikarimSemasi>;

/**
 * OCR / Metin Tarama API Giriş Şeması
 */
export const aiBelgeGirdiSemasi = z.object({
  gorselBase64: z.string().optional(),
  mimeType: z.string().default("image/jpeg"),
  hamMetin: z.string().optional(),
  belgeTipi: z.enum(["fis_fatura", "cari_bilgisi", "otomatik"]).default("otomatik"),
});

export type AiBelgeGirdi = z.infer<typeof aiBelgeGirdiSemasi>;
