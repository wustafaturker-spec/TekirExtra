import { z } from "zod";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

export const FIYAT_DOVIZLERI = DOVIZ_CINSLERI;

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

export const fiyatListesiTopluSemasi = z.object({
  surum: z.string().regex(/^[a-f0-9]{64}$/),
  kaynak: z.literal("endeks").optional(),
  kalemler: z.array(fiyatListesiKalemSemasi).min(1).max(5000),
  yeniAd: z.string().trim().min(1).max(100).optional(),
}).strict().refine((g) => new Set(g.kalemler.map((k) => k.stokId)).size === g.kalemler.length, "Ürün tekrar edemez");
