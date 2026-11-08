import { z } from "zod";

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const pesinVergiSorguSemasi = z.object({ baslangic: tarih, bitis: tarih }).refine((s) => s.baslangic <= s.bitis, { message: "Başlangıç tarihi bitişten sonra olamaz" });

export const pesinVergiMahsupSemasi = z.object({
  kalemler: z.array(z.object({ kaynakTur: z.enum(["gelir", "fatura", "pazaryeri"]), kaynakId: z.string().uuid() })).min(1).max(5000),
  beyannameTuru: z.enum(["gecici_vergi", "yillik"]),
  yil: z.number().int().min(2000).max(2100),
  donem: z.number().int().min(1).max(4).nullable().optional(),
  not: z.string().trim().max(500).optional(),
}).superRefine((g, c) => {
  if (g.beyannameTuru === "gecici_vergi" && !g.donem) c.addIssue({ code: "custom", path: ["donem"], message: "Geçici vergi dönemini seçin" });
  if (g.beyannameTuru === "yillik" && g.donem) c.addIssue({ code: "custom", path: ["donem"], message: "Yıllık beyannamede dönem seçilmez" });
});

export const pesinVergiGeriAlSemasi = z.object({ mahsupIdleri: z.array(z.string().uuid()).min(1).max(5000) });
