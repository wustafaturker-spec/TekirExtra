import { z } from "zod";

export const ocrTaramaSemasi = z.object({
  gorselBase64: z.string().min(10, "Lütfen geçerli bir görsel verisi yükleyin"),
});
