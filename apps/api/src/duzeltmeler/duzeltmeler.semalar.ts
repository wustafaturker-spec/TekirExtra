import { z } from "zod";

export const duzeltmeListeSemasi = z.object({
  tur: z.enum(["banka_ekstre", "kredi_karti", "masraf", "pos", "ebelge", "stok", "cek_senet", "fatura_cari"]).optional(),
  onem: z.enum(["bilgi", "uyari", "kritik"]).optional(),
  durum: z.enum(["acik", "incelemede", "beklemede", "cozuldu", "yoksayildi"]).optional(),
  atananUserId: z.string().uuid().optional(),
  kaynak: z.string().trim().min(1).max(120).optional(),
  baslangic: z.coerce.date().optional(),
  bitis: z.coerce.date().optional(),
  sayfa: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).refine((girdi) => !girdi.baslangic || !girdi.bitis || girdi.baslangic <= girdi.bitis, { message: "Başlangıç tarihi bitiş tarihinden sonra olamaz", path: ["bitis"] });

export const duzeltmeAtaSemasi = z.object({ userId: z.string().uuid().nullable() });
const topluIdler = z.array(z.string().uuid()).min(1).max(100).transform((idler) => [...new Set(idler)]);
export const duzeltmeTopluAtaSemasi = z.object({ ids: topluIdler, userId: z.string().uuid().nullable() });
export const duzeltmeTopluYoksaySemasi = z.object({ ids: topluIdler, aciklama: z.string().trim().min(2).max(500) });
export const duzeltmeNotSemasi = z.object({ aciklama: z.string().trim().min(2).max(2000) });
export const duzeltmeDurumSemasi = z.object({
  durum: z.enum(["incelemede", "beklemede", "cozuldu", "yoksayildi"]),
  aciklama: z.string().trim().min(2).max(2000).optional(),
});
