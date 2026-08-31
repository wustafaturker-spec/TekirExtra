import { z } from "zod";

export const duzeltmeListeSemasi = z.object({
  tur: z.enum(["banka_ekstre", "kredi_karti", "masraf", "pos", "ebelge", "stok", "cek_senet", "fatura_cari"]).optional(),
  onem: z.enum(["bilgi", "uyari", "kritik"]).optional(),
  durum: z.enum(["acik", "incelemede", "beklemede", "cozuldu", "yoksayildi"]).optional(),
  atananUserId: z.string().uuid().optional(),
  sayfa: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const duzeltmeAtaSemasi = z.object({ userId: z.string().uuid().nullable() });
export const duzeltmeNotSemasi = z.object({ aciklama: z.string().trim().min(2).max(2000) });
export const duzeltmeDurumSemasi = z.object({
  durum: z.enum(["incelemede", "beklemede", "cozuldu", "yoksayildi"]),
  aciklama: z.string().trim().min(2).max(2000).optional(),
});
