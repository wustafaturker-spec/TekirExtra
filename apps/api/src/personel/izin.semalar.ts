import { z } from "zod";

export const izinTuruOlusturSemasi = z.object({
  kod: z.string().trim().min(2).max(32).regex(/^[a-z0-9_]+$/),
  ad: z.string().trim().min(2).max(80),
  ucretli: z.boolean().default(true),
  bakiyeTakibi: z.boolean().default(true),
});

export const izinTalepOlusturSemasi = z.object({
  personelId: z.string().uuid(),
  izinTuruId: z.string().uuid(),
  baslangicTarihi: z.coerce.date(),
  bitisTarihi: z.coerce.date(),
  aciklama: z.string().trim().max(500).optional().nullable(),
}).superRefine((girdi, ctx) => {
  if (girdi.bitisTarihi < girdi.baslangicTarihi) ctx.addIssue({ code: "custom", path: ["bitisTarihi"], message: "Bitiş tarihi başlangıç tarihinden önce olamaz" });
});

export const izinKararSemasi = z.object({
  neden: z.string().trim().min(3).max(500).optional(),
});

export const izinRetSemasi = z.object({
  neden: z.string().trim().min(3, "Ret nedeni en az 3 karakter olmalıdır").max(500),
});

export const izinBakiyeDuzeltSemasi = z.object({
  personelId: z.string().uuid(),
  izinTuruId: z.string().uuid(),
  tip: z.enum(["devir", "hak_edis", "duzeltme_artis", "duzeltme_azalis"]),
  gun: z.coerce.number().positive().max(365),
  aciklama: z.string().trim().min(3).max(500),
});

export const tatilGunuSemasi = z.object({
  tarih: z.coerce.date(),
  ad: z.string().trim().min(2).max(100),
  yarimGun: z.boolean().default(false),
});
