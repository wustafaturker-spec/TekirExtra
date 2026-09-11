import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";

/** Çoklu depo (STK-07) şemaları. */

const pozitifOndalik = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli");

export const depoOlusturSemasi = z.object({
  kod: z.string().min(1).max(32),
  ad: z.string().min(2).max(120),
  adres: z.string().max(500).optional().nullable(),
  sorumlu: z.string().max(120).optional().nullable(),
  varsayilan: z.boolean().default(false),
});

export const depoGuncelleSemasi = guncellemeSemasi(depoOlusturSemasi).extend({
  aktif: z.boolean().optional(),
});

export const transferKalemSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().optional().nullable(),
  girilenBirim: z.string().min(1).max(20),
  girilenMiktar: pozitifOndalik,
});

export const transferOlusturSemasi = z
  .object({
    tarih: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"),
    kaynakDepoId: z.string().uuid(),
    hedefDepoId: z.string().uuid(),
    aciklama: z.string().max(500).optional().nullable(),
    kalemler: z.array(transferKalemSemasi).min(1, "En az bir transfer kalemi eklemelisiniz"),
  })
  .refine((g) => g.kaynakDepoId !== g.hedefDepoId, {
    message: "Kaynak ve hedef depo aynı olamaz",
    path: ["hedefDepoId"],
  });
