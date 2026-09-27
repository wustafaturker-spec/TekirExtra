import { z } from "zod";

/** EBLG-41: liste süzgeci; "gonderilmedi" henüz kaydı olmayan irsaliyeleri seçer. */
export const gidenDurumSemasi = z
  .enum(["gonderilmedi", "kuyrukta", "iletildi", "kabul", "kismi_kabul", "ret", "hata"])
  .optional()
  .catch(undefined);

/** EBLG-43: toplu gönderim; üst sınır serviste denetlenir. */
export const topluGonderSemasi = z.object({
  belgeIdler: z.array(z.string().uuid("Geçersiz belge kimliği")).min(1, "En az bir irsaliye seçin").max(50),
});

/** EBLG-106: taslakta kalan irsaliyeye alıcı etiketi verip gönderme. */
export const taslakGonderSemasi = z.object({
  postaKutusu: z.string().trim().min(1, "Posta kutusu seçin"),
  kartaKaydet: z.boolean().optional(),
});
