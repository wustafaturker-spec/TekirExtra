import { z } from "zod";
import { YABANCI_DOVIZLER } from "@tekirextra/shared";

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır");
const doviz = z.enum(YABANCI_DOVIZLER, { message: "Desteklenen bir yabancı para birimi seçin" });
const kur = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(",", "."))
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, "Kur en fazla 6 ondalıklı pozitif bir sayı olmalıdır"));
const gerekce = z.string().trim().min(5, "Gerekçe en az 5 karakter olmalıdır").max(500);

export const kurAraligiSemasi = z.object({ baslangic: tarih, bitis: tarih });

/** DVZ-05: elle kur. */
export const elleKurSemasi = z.object({ tarih, dovizCinsi: doviz, alis: kur, satis: kur, gerekce });

export const elleKurSilSemasi = z.object({ tarih, dovizCinsi: doviz, gerekce });
