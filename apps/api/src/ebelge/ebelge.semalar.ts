import { z } from "zod";

/** EBLG-05: onay ekranından gelen satır → stok kartı eşleştirmeleri. */
export const gelenOnaySemasi = z.object({
  satirEslesmeleri: z
    .array(
      z.object({
        siraNo: z.number().int().min(1),
        stokId: z.string().uuid(),
      }),
    )
    .min(1, "En az bir satır eşleştirmesi gerekli"),
  yeniCariOnay: z.boolean().optional(),
});

/** EBLG-06: ticari faturaya kabul/ret yanıtı. */
export const gelenYanitSemasi = z
  .object({
    yanit: z.enum(["kabul", "ret"]),
    gerekce: z.string().max(500).optional().nullable(),
  })
  .refine((g) => g.yanit !== "ret" || Boolean(g.gerekce?.trim()), {
    message: "Ret yanıtı için gerekçe zorunludur",
    path: ["gerekce"],
  });

export const earsivIptalSemasi = z.object({
  iptalTarihi: z.coerce.date(),
  sube: z.string().max(50).optional(),
});

export const earsivRaporAralikSemasi = z.object({
  baslangic: z.coerce.date(),
  bitis: z.coerce.date(),
}).superRefine((g, ctx) => {
  if (g.baslangic > g.bitis) ctx.addIssue({ code: "custom", path: ["bitis"], message: "Başlangıç tarihi bitişten sonra olamaz" });
  if (g.bitis.getTime() - g.baslangic.getTime() > 366 * 86400000) ctx.addIssue({ code: "custom", path: ["bitis"], message: "Rapor aralığı en fazla 366 gün olabilir" });
});

export const gelenXmlYukleSemasi = z.object({
  xml: z.string().min(10, "Geçerli bir XML içeriği girilmelidir"),
});
