import { z } from "zod";

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const STOK_TIPLERI = ["urun", "hizmet", "sarf"] as const;

/** STK-19: fire/zayi/numune/promosyon çıkış gibi, acilis giriş gibi işlenir. */
export const STOK_HAREKET_TIPLERI = [
  "giris",
  "cikis",
  "sayim_duzeltme",
  "fire",
  "zayi",
  "numune",
  "promosyon",
  "acilis",
] as const;

export const stokKartOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(2).max(255),
  kisaAd: z.string().max(80).optional().nullable(),
  aciklama: z.string().max(2000).optional().nullable(),
  tip: z.enum(STOK_TIPLERI).default("urun"),
  marka: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  mensei: z.string().max(60).optional().nullable(),
  gtipKodu: z.string().max(20).optional().nullable(),
  ureticiUrunKodu: z.string().max(64).optional().nullable(),
  barkod: z.string().max(120).optional().nullable(),
  kategoriId: z.string().uuid().optional().nullable(),
  anaBirim: z.string().min(1).max(20).default("adet"),
  kdvOrani: pozitifOndalik.default("20"),
  alisFiyati: pozitifOndalik.optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
  kritikSeviye: pozitifOndalik.optional().nullable(),
  minStok: pozitifOndalik.optional().nullable(),
  maksStok: pozitifOndalik.optional().nullable(),
  guvenlikStogu: pozitifOndalik.optional().nullable(),
  tedarikSuresiGun: z.number().int().min(0).max(365).optional().nullable(),
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
  tip: z.enum(STOK_HAREKET_TIPLERI),
  miktar: pozitifOndalik,
  girilenBirim: z.string().min(1).max(20),
  girilenMiktar: pozitifOndalik,
  maliyet: pozitifOndalik.default("0"),
  tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
  aciklama: z.string().max(500).optional().nullable(),
});

export const stokBarkodSemasi = z.object({
  barkod: z.string().min(3).max(120),
  birim: z.string().max(20).optional().nullable(),
  satisFiyati: pozitifOndalik.optional().nullable(),
});

export const stokTedarikciSemasi = z.object({
  cariId: z.string().uuid(),
  tedarikciUrunKodu: z.string().max(64).optional().nullable(),
  alisFiyati: pozitifOndalik.optional().nullable(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  tedarikSuresiGun: z.number().int().min(0).max(365).optional().nullable(),
  varsayilan: z.boolean().default(false),
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
