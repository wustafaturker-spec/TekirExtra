import { z } from "zod";
const para = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Pozitif tutar gerekli");
export const krediKartiOlusturSemasi = z.object({
  ad: z.string().trim().min(2).max(100), bankaAdi: z.string().trim().min(2).max(100), sonDortHane: z.string().regex(/^\d{4}$/, "Kartın son 4 hanesi gereklidir"),
  kartSahibi: z.string().trim().max(100).optional().nullable(), limit: para, dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  hesapKesimGunu: z.number().int().min(1).max(31), sonOdemeGunu: z.number().int().min(1).max(31), bagliBankaHesapId: z.string().uuid().optional().nullable(),
  renk: z.enum(["lacivert", "turkuaz", "mor", "bordo"]).default("lacivert"),
  asgariOdemeOrani: z.number().min(1).max(100).optional().nullable(),
});

/** KSB-10: kart ayarları; kesim günü değişikliği kesinleşmiş ekstreleri etkilemez. */
export const krediKartiGuncelleSemasi = z.object({
  limit: para.optional(), hesapKesimGunu: z.number().int().min(1).max(31).optional(), sonOdemeGunu: z.number().int().min(1).max(31).optional(),
  asgariOdemeOrani: z.number().min(1).max(100).nullable().optional(), bagliBankaHesapId: z.string().uuid().nullable().optional(), aktif: z.boolean().optional(),
});
export const krediKartiHareketSemasi = z.object({
  krediKartiId: z.string().uuid(), tip: z.enum(["harcama", "iade", "faiz", "aidat"]), tarih: z.string().date(),
  aciklama: z.string().trim().min(2).max(200), tutar: para, taksitSayisi: z.number().int().min(1).max(36).default(1), belgeNo: z.string().trim().max(50).optional().nullable(),
  // KSB-10: doğrudan harcama masraf olarak yazılır; kategori ve satıcı gerekir. Faiz/aidat kendi kategorisine gider.
  kategoriId: z.string().uuid().optional().nullable(), saticiUnvan: z.string().trim().max(200).optional().nullable(),
  kdvOrani: z.number().min(0).max(100).optional(), limitAsimiOnay: z.boolean().optional(),
}).superRefine((g, ctx) => {
  if (g.tip === "harcama" && !g.kategoriId) ctx.addIssue({ code: "custom", path: ["kategoriId"], message: "Harcama için masraf kategorisi seçin" });
});

export const krediKartiCariOdemeSemasi = z.object({
  krediKartiId: z.string().uuid(), cariId: z.string().uuid(), faturaId: z.string().uuid().optional().nullable(), tarih: z.string().date(),
  cariOdemeTutari: para, komisyonTutari: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v), "Geçerli komisyon tutarı gerekli").default("0"),
  taksitSayisi: z.number().int().min(1).max(36).default(1), ilkTaksitTarihi: z.string().date(),
  aciklama: z.string().trim().min(2).max(200), belgeNo: z.string().trim().max(50).optional().nullable(),
  limitAsimiOnay: z.boolean().optional(),
});

export const krediKartiEkstreOdemeSemasi = z.object({
  krediKartiId: z.string().uuid(), bankaHesapId: z.string().uuid(), tarih: z.string().date(), tutar: para,
  aciklama: z.string().trim().min(2).max(200).default("Kredi kartı ekstre ödemesi"), belgeNo: z.string().trim().max(50).optional().nullable(),
});

/** KSB-10: banka ekstresiyle kesinleştirme. */
export const krediKartiKesinlestirSemasi = z.object({
  bankaTutari: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d{1,13}(\.\d{1,2})?$/.test(v), "Bankanın ekstre tutarını girin"),
  bankaAsgariTutari: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v), "Geçerli asgari tutar girin").optional().nullable(),
});
