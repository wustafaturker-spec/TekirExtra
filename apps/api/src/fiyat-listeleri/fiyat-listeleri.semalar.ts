import { z } from "zod";

export const FIYAT_DOVIZLERI = ["TRY", "USD", "EUR"] as const;

/** Ondalık girdiler API'de string taşınır (hassasiyet korunur, NFR-10). */
const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const fiyatListesiOlusturSemasi = z.object({
  ad: z.string().min(1, "Liste adı gerekli").max(100),
  dovizCinsi: z.enum(FIYAT_DOVIZLERI).default("TRY"),
  aktif: z.boolean().optional(),
});

export const fiyatListesiGuncelleSemasi = z.object({
  ad: z.string().min(1).max(100).optional(),
  dovizCinsi: z.enum(FIYAT_DOVIZLERI).optional(),
  aktif: z.boolean().optional(),
});

export const fiyatListesiKalemSemasi = z.object({
  stokId: z.uuid(),
  fiyat: pozitifOndalik,
});
