import { z } from "zod";

export const ocrTaramaSemasi = z.object({
  gorselBase64: z.string().min(10, "Lütfen geçerli bir görsel verisi yükleyin"),
});

export const aiTahminSemasi = z.object({
  tarihAraligiGun: z.coerce.number().min(7).max(90).default(30),
});
