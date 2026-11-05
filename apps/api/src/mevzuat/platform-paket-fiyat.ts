import { z } from "zod";
import { paketFiyatiHesapla, type PaketFiyatSozlesmesi } from "../abonelik-odeme/paket-fiyat-sozlesmesi";

export interface PaketFiyatlandirmasi extends PaketFiyatSozlesmesi { gecerlilikTarihi: string }

/** Takvim günü Türkiye tarihiyle yorumlanır; saat veya otomatik aktivasyon içermez. */
export const paketFiyatSemasi = z.object({
  paraBirimi: z.literal("TRY"), vergiDahil: z.literal(false),
  gecerlilikTarihi: z.iso.date().refine((g) => !g.startsWith("0000-"), "Geçerlilik yılı en az 0001 olmalıdır."),
  kdvOrani: z.string(),
  donemler: z.array(z.object({
    aySayisi: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    matrah: z.string(),
  }).strict()).min(1).max(4),
}).strict().superRefine((g, ctx) => {
  if (!g.donemler.length) return;
  try { paketFiyatiHesapla(g, g.donemler[0].aySayisi); }
  catch (e) { ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Geçersiz fiyat sözleşmesi." }); }
});
