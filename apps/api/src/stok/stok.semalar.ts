import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const stokKartOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(2).max(255),
  tip: z.enum(["urun", "hizmet"]).default("urun"),
  barkod: z.string().max(120).optional().nullable(),
  kategoriId: z.string().uuid().optional().nullable(),
  anaBirim: z.string().min(1).max(20).default("adet"),
  kdvOrani: pozitifOndalik.default("20"),
  alisFiyati: pozitifOndalik.optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
  kritikSeviye: pozitifOndalik.optional().nullable(),
  gorselUrl: z.string().url().max(500).optional().nullable(),
});

export const stokKartGuncelleSemasi = stokKartOlusturSemasi.partial().extend({
  aktif: z.boolean().optional(),
});

export const kategoriSemasi = z.object({
  ad: z.string().min(2).max(100),
  ustId: z.string().uuid().optional().nullable(),
});

export const stokBirimSemasi = z.object({
  ad: z.string().min(1).max(20),
  katsayi: pozitifOndalik,
});

export const stokHareketOlusturSemasi = z.object({
  stokId: z.string().uuid(),
  tip: z.enum(["giris", "cikis", "sayim_duzeltme"]),
  miktar: pozitifOndalik,
  girilenBirim: z.string().min(1).max(20),
  girilenMiktar: pozitifOndalik,
  maliyet: pozitifOndalik.default("0"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
});

export const sayimKalemSemasi = z.object({
  stokId: z.string().uuid(),
  fiiliMiktar: pozitifOndalik,
});

export const sayimOlusturSemasi = z.object({
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
  kalemler: z.array(sayimKalemSemasi).min(1, "En az bir sayım kalemi eklemelisiniz"),
});
