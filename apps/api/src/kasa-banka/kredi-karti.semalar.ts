import { z } from "zod";
const para = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Pozitif tutar gerekli");
export const krediKartiOlusturSemasi = z.object({
  ad: z.string().trim().min(2).max(100), bankaAdi: z.string().trim().min(2).max(100), sonDortHane: z.string().regex(/^\d{4}$/, "Kartın son 4 hanesi gereklidir"),
  kartSahibi: z.string().trim().max(100).optional().nullable(), limit: para, dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  hesapKesimGunu: z.number().int().min(1).max(31), sonOdemeGunu: z.number().int().min(1).max(31), bagliBankaHesapId: z.string().uuid().optional().nullable(),
  renk: z.enum(["lacivert", "turkuaz", "mor", "bordo"]).default("lacivert"),
});
export const krediKartiHareketSemasi = z.object({
  krediKartiId: z.string().uuid(), tip: z.enum(["harcama", "iade", "odeme", "faiz", "aidat"]), tarih: z.string().date(),
  aciklama: z.string().trim().min(2).max(200), tutar: para, taksitSayisi: z.number().int().min(1).max(36).default(1), belgeNo: z.string().trim().max(50).optional().nullable(),
});
