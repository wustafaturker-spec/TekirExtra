import { z } from "zod";

/** AI-32: gelen e-postadaki teklif talebinden taslak teklif (Modül Ayarları). */
export const TEKLIF_TALEBI_MODULU = "eposta_teklif_taslagi";

/** Taslağı kendi kimliğiyle açabilen roller; cari açma onayı muhasebe/yönetici ister. */
export const TEKLIF_TALEBI_ROLLERI = ["yonetici", "muhasebe", "satis"] as const;

export const teklifTalebiAyariSemasi = z.object({
  acik: z.boolean().default(false),
  sorumluUserId: z.uuid().transform((s) => s.toLowerCase()).nullable().default(null),
  /** Sunucu yazar: özellik açıldığı an; yalnız bundan sonra gelen e-postalar kendiliğinden işlenir. */
  acildiAt: z.iso.datetime().nullable().default(null),
}).strict().refine((v) => !v.acik || v.sorumluUserId !== null, "Teklif talebi taslağı için sorumlu seçilmeli");

export type TeklifTalebiAyari = z.infer<typeof teklifTalebiAyariSemasi>;
