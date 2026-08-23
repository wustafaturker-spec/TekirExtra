import { z } from "zod";

export const aktarimFiltreSemasi = z.object({
  baslangicTarihi: z.coerce.date(),
  bitisTarihi: z.coerce.date(),
  tur: z.enum(["satis", "alis", "hepsi"]).default("hepsi"),
});
