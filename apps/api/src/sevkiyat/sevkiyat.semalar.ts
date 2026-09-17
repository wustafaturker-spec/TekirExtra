import { z } from "zod";
import { PLAKA_HATA_MESAJI, plakaGecerliMi, plakaNormalize } from "@tekirextra/shared";
import { guncellemeSemasi } from "../core/sema";

/**
 * Kayıtlı araç ve şoför kartları (EBLG-25). Kartlar irsaliyede seçildiğinde
 * değerleri belgeye kopyalanır; belge kartı referans almaz.
 */
export const aracOlusturSemasi = z.object({
  // Kart plakası irsaliyeye kopyalanıyor; GİB biçimi burada da aranır
  // (şematron 14.09.2026 §3), yoksa hatalı plaka belgeye taşınır.
  plaka: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .transform(plakaNormalize)
    .refine(plakaGecerliMi, PLAKA_HATA_MESAJI),
  dorsePlaka: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .transform((deger) => (deger ? plakaNormalize(deger) : deger))
    .refine((deger) => !deger || plakaGecerliMi(deger), PLAKA_HATA_MESAJI),
  aciklama: z.string().trim().max(120).optional().nullable(),
  aktif: z.boolean().default(true),
});
export const aracGuncelleSemasi = guncellemeSemasi(aracOlusturSemasi);

export const soforOlusturSemasi = z.object({
  ad: z.string().trim().min(2).max(80),
  soyad: z.string().trim().min(2).max(80),
  /** GİB `DriverPerson/NationalityID`; kişisel veri olduğu için zorunlu değil. */
  tckn: z.string().regex(/^\d{11}$/, "TCKN 11 haneli olmalıdır").optional().nullable(),
  aktif: z.boolean().default(true),
});
export const soforGuncelleSemasi = guncellemeSemasi(soforOlusturSemasi);
