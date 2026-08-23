import { z } from "zod";

export const personelBelgeTuruSemasi = z.enum([
  "kimlik", "is_sozlesmesi", "diploma", "sertifika", "saglik_raporu",
  "adli_sicil", "ikametgah", "askerlik", "sgk_bildirgesi", "diger",
]);

const tarih = z.string().date().optional().or(z.literal("")).transform((v) => v || undefined);

export const personelBelgeMetaSemasi = z.object({
  tur: personelBelgeTuruSemasi,
  aciklama: z.string().trim().max(500).optional().or(z.literal("")),
  belgeTarihi: tarih,
  gecerlilikTarihi: tarih,
}).superRefine((veri, ctx) => {
  if (veri.belgeTarihi && veri.gecerlilikTarihi && veri.gecerlilikTarihi < veri.belgeTarihi) {
    ctx.addIssue({ code: "custom", path: ["gecerlilikTarihi"], message: "Geçerlilik tarihi belge tarihinden önce olamaz" });
  }
});
