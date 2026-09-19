import { IADE_REFERANS_UST_SINIRI, odemeSekliGecerliMi, tasimaSekliGecerliMi, teslimSartiGecerliMi } from "@tekirextra/shared";
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

/** EBLG-26/53: sihirbazda seçilen e-Arşiv teslim şekli ve ihracat alanları; boşsa faturadaki kalır. */
export const ebelgeGonderSemasi = z.object({
  earsivGonderimSekli: z.enum(["elektronik", "kagit"]).optional(),
  ihracat: z
    .object({
      teslimTarihi: z.coerce.date().nullable().optional(),
      teslimSarti: z.string().refine(teslimSartiGecerliMi, "Tanımsız teslim şartı").nullable().optional(),
      tasimaSekli: z.string().refine(tasimaSekliGecerliMi, "Tanımsız taşıma şekli").nullable().optional(),
    })
    .optional(),
  /** EBLG-56: internet satışı işareti ve alan grubu; işaret kalkarsa alanlar temizlenir. */
  internetSatisi: z
    .object({
      internetSatisi: z.boolean(),
      webAdresi: z.string().max(200).nullable().optional(),
      odemeSekli: z.string().refine(odemeSekliGecerliMi, "Tanımsız ödeme şekli").nullable().optional(),
      odemeTarihi: z.coerce.date().nullable().optional(),
      odemeAracisi: z.string().max(100).nullable().optional(),
      tasiyiciUnvan: z.string().max(200).nullable().optional(),
      tasiyiciVkn: z.string().regex(/^\d{10}$|^\d{11}$/, "Taşıyıcı VKN/TCKN 10 ya da 11 haneli olmalıdır").nullable().optional(),
      gonderiTarihi: z.coerce.date().nullable().optional(),
    })
    .optional(),
  /**
   * EBLG-58: alış iadesinde iade edilen faturalar. Listeden seçilen fatura
   * kimliğiyle gelir; sistemde olmayan fatura numarası ve tarihiyle girilir.
   */
  iade: z
    .object({
      referanslar: z
        .array(
          z.object({
            kaynakFaturaId: z.string().uuid().nullable().optional(),
            belgeNo: z.string().max(16).nullable().optional(),
            tarih: z.coerce.date().nullable().optional(),
          }),
        )
        .max(IADE_REFERANS_UST_SINIRI, `En çok ${IADE_REFERANS_UST_SINIRI} fatura referans verilebilir`),
    })
    .optional(),
});

/** EBLG-54: gümrük beyanname bilgisi; belge gönderildikten sonra da girilebilir. */
export const gumrukBeyannameSemasi = z.object({
  no: z.string().max(40).nullable().optional(),
  tarih: z.coerce.date().nullable().optional(),
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
