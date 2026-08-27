import { z } from "zod";

export const PROJE_DURUMLARI = [
  "planlanan",
  "aktif",
  "tamamlandi",
  "durduruldu",
  "iptal",
] as const;

export const PROJE_ALT_KIRILIM_TIPLERI = [
  "gelir",
  "gider",
  "her_ikisi",
] as const;

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const projeOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(2).max(255),
  aciklama: z.string().max(2000).optional().nullable(),
  cariId: z.string().uuid().optional().nullable(),
  baslangicTarihi: z.string().date("YYYY-MM-DD biçiminde olmalıdır").optional().nullable(),
  bitisTarihi: z.string().date("YYYY-MM-DD biçiminde olmalıdır").optional().nullable(),
  durum: z.enum(PROJE_DURUMLARI).default("planlanan"),
  sorumluUserId: z.string().uuid().optional().nullable(),
  hedefGelir: pozitifOndalik.optional(),
  hedefGider: pozitifOndalik.optional(),
  notlar: z.string().max(4000).optional().nullable(),
});

export const projeGuncelleSemasi = projeOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
});

export const projeAsamaSemasi = z.object({
  sira: z.number().int().min(0).default(0),
  ad: z.string().min(1).max(120),
  aciklama: z.string().max(1000).optional().nullable(),
  baslangicTarihi: z.string().date().optional().nullable(),
  bitisTarihi: z.string().date().optional().nullable(),
  tamamlandi: z.boolean().optional(),
});

export const projeAltKirilimSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(1).max(120),
  tip: z.enum(PROJE_ALT_KIRILIM_TIPLERI).default("gider"),
  butceTutari: pozitifOndalik.optional(),
  aciklama: z.string().max(1000).optional().nullable(),
});

export const projeNotSemasi = z.object({
  icerik: z.string().min(1).max(4000),
});
