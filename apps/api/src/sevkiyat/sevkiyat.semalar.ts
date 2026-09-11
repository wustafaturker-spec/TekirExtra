import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";

/**
 * Kayıtlı araç ve şoför kartları (EBLG-25). Kartlar irsaliyede seçildiğinde
 * değerleri belgeye kopyalanır; belge kartı referans almaz.
 */
export const aracOlusturSemasi = z.object({
  plaka: z.string().trim().min(2).max(20),
  dorsePlaka: z.string().trim().max(20).optional().nullable(),
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
