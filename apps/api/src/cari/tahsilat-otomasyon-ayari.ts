import { z } from "zod";
export const TAHSILAT_OTOMASYONU = "tahsilat_otomasyonu";
export const tahsilatOtomasyonSemasi = z.object({
  acik: z.boolean().default(false),
  uygulamaIciBildirim: z.boolean().default(false),
  sorumluUserId: z.uuid().transform((s) => s.toLowerCase()).nullable().default(null),
}).strict().refine((v) => !v.acik || v.sorumluUserId !== null, "Otomatik takip için sorumlu seçilmeli");
