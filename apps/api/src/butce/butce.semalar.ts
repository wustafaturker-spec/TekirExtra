import { z } from "zod";

export const yilSemasi = z.coerce.number().int().min(2000, "Geçersiz yıl").max(2100, "Geçersiz yıl");

/** BUT-08: taslak boş ya da geçen yılın gerçekleşeninden, isteğe bağlı artışla. */
export const butceOlusturSemasi = z.object({
  kaynak: z.enum(["bos", "gecen_yil"]).default("bos"),
  artisYuzde: z.coerce.number().min(-100).max(1000).default(0),
});

const tutar = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Tutar sıfır ya da pozitif, en fazla 2 ondalık olmalıdır"));

export const butceSatirlariSemasi = z.object({
  satirlar: z
    .array(z.object({ anahtar: z.string().min(1).max(120), ay: z.number().int().min(1).max(12), tutar }))
    .max(12 * 1000),
});

export const revizyonAcSemasi = z.object({
  gerekce: z.string().trim().min(5, "Revizyon gerekçesi en az 5 karakter olmalıdır").max(500),
});
