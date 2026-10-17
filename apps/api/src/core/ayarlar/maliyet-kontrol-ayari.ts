import { z } from "zod";

export const MALIYET_KONTROL_MODULU = "maliyet_kontrolu";
export const maliyetKontrolAyariSemasi = z.object({
  surum: z.literal(1).default(1),
  mod: z.enum(["kapali", "salt_okunur", "pilot", "acik"]).default("kapali"),
}).strict();
export type MaliyetKontrolModu = z.infer<typeof maliyetKontrolAyariSemasi>["mod"];
