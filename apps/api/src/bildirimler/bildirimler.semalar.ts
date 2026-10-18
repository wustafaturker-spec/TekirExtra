import { z } from "zod";

export const BILDIRIM_TURLERI = ["duzeltme", "ebelge", "vade", "cek_senet", "stok", "donem", "entegrasyon", "satin_alma", "personel", "teklif"] as const;

export const bildirimListeSemasi = z.object({
  tur: z.enum(BILDIRIM_TURLERI).optional(),
  onem: z.enum(["bilgi", "uyari", "kritik"]).optional(),
  durum: z.enum(["yeni", "okundu", "ustlenildi", "aksiyon_alindi", "yoksayildi"]).optional(),
  /** Yalnız açık (kapanmamış) bildirimler; varsayılan açık olanlar. */
  kapanmis: z.enum(["true", "false"]).optional(),
  /** Yönetici, firma genelindeki teslimatları da görebilir (BLD-09). */
  kapsam: z.enum(["bana", "firma"]).default("bana"),
  sayfa: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const idler = z.array(z.string().uuid()).min(1).max(200).transform((liste) => [...new Set(liste)]);
export const bildirimOkunduSemasi = z.object({ ids: idler });
export const bildirimAksiyonSemasi = z.object({ not: z.string().trim().min(2).max(2000).optional() });

export const bildirimTercihSemasi = z.object({
  tur: z.enum(BILDIRIM_TURLERI),
  uygulamaIci: z.boolean(),
  eposta: z.boolean(),
});

/** "HH:mm" — sessiz saat gece yarısını aşabilir (22:00–07:00). */
const saat = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat HH:mm biçiminde olmalıdır");
export const sessizSaatSemasi = z
  .object({ baslangic: saat.nullable(), bitis: saat.nullable() })
  .refine((girdi) => (girdi.baslangic === null) === (girdi.bitis === null), {
    message: "Sessiz saat aralığının iki ucu birlikte verilmelidir",
    path: ["bitis"],
  });
