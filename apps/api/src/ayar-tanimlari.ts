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

registerModulAyar(
  "cari",
  z.object({
    varsayilanVadeGun: z.number().int().min(0).max(365),
    varsayilanDoviz: z.enum(["TRY", "USD", "EUR"]),
  }),
  { varsayilanVadeGun: 14, varsayilanDoviz: "TRY" },
);

registerModulAyar(
  "stok",
  z.object({
    varsayilanBirim: z.string().min(1).max(20),
    kritikSeviyeUyarisi: z.boolean(),
  }),
  { varsayilanBirim: "adet", kritikSeviyeUyarisi: true },
);

registerModulAyar(
  "fatura",
  z.object({
    varsayilanSeri: z.string().regex(/^[A-Z]{3}$/).default("TKR"),
    varsayilanKdvOrani: z.number().min(0).max(100).default(20),
    faturaSablonu: z.enum(["standart", "modern", "klasik"]).default("standart"),
  }),
  { varsayilanSeri: "TKR", varsayilanKdvOrani: 20, faturaSablonu: "standart" },
);

registerModulAyar(
  "kasaBanka",
  z.object({
    varsayilanKasaId: z.string().uuid().optional().nullable(),
    varsayilanBankaHesapId: z.string().uuid().optional().nullable(),
  }),
  { varsayilanKasaId: null, varsayilanBankaHesapId: null },
);



