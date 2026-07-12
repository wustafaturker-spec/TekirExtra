import { z } from "zod";
import { registerModulAyar } from "./core/ayarlar/ayar-kayit";

/**
 * Modül ayar tanımları (AYR-01/03). Her modül geldiği aşamada kendi
 * tanımını buraya ekler; saklama/doğrulama/API altyapıdan gelir.
 */
registerModulAyar(
  "arayuz",
  z.object({
    tema: z.enum(["acik", "koyu"]),
    sayfaBoyutu: z.number().int().min(10).max(200),
  }),
  { tema: "acik", sayfaBoyutu: 50 },
);
