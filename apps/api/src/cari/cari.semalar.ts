import { z } from "zod";

export const CARI_TIPLERI = ["musteri", "tedarikci", "her_ikisi"] as const;
export const DOVIZLER = ["TRY", "USD", "EUR"] as const;

/** Ondalık girdiler API'de string taşınır (hassasiyet korunur, NFR-10). */
const ondalik = z
  .string()
  .regex(/^-?\d{1,13}(\.\d{1,6})?$/, "Geçersiz sayısal değer");
const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const cariOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  unvan: z.string().min(2).max(255),
  tip: z.enum(CARI_TIPLERI),
  vknTckn: z.string().regex(/^\d{10,11}$/).optional(),
  vergiDairesi: z.string().max(120).optional(),
  eposta: z.email().optional(),
  telefon: z.string().max(32).optional(),
  iban: z.string().max(34).optional(),
  dovizCinsi: z.enum(DOVIZLER).default("TRY"),
  fiyatListesiId: z.uuid().optional(),
  varsayilanIskonto: pozitifOndalik.optional(),
  varsayilanVadeGun: z.number().int().min(0).max(365).optional(),
  riskLimiti: pozitifOndalik.optional(),
  notlar: z.string().max(2000).optional(),
});
export const cariGuncelleSemasi = cariOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
});

export const adresSemasi = z.object({
  tip: z.enum(["fatura", "sevk"]),
  baslik: z.string().min(1).max(80),
  adres: z.string().min(2).max(500),
  il: z.string().max(60).optional(),
  ilce: z.string().max(60).optional(),
  ulke: z.string().length(2).default("TR"),
});

export const kisiSemasi = z.object({
  adSoyad: z.string().min(2).max(120),
  gorev: z.string().max(80).optional(),
  telefon: z.string().max(32).optional(),
  eposta: z.email().optional(),
});

export const cariHareketSemasi = z.object({
  tip: z.enum(["borc", "alacak"]),
  tutar: pozitifOndalik,
  dovizCinsi: z.enum(DOVIZLER).default("TRY"),
  kur: pozitifOndalik.default("1"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  vadeTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional(),
  aciklama: z.string().max(500).optional(),
});

export type CariOlusturGirdisi = z.infer<typeof cariOlusturSemasi>;
export type CariHareketGirdisi = z.infer<typeof cariHareketSemasi>;
export { ondalik, pozitifOndalik };
