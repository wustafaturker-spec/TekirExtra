import { z } from "zod";
const tutarSemasi = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Geçerli bir tutar girin").refine((x) => Number(x) > 0, "Tutar pozitif olmalıdır");
const nedenSemasi = z.string().trim().min(3, "Gerekçe en az 3 karakter olmalıdır").max(300);
export const posTahsilatBaslatSemasi = z.object({
  posHesapId: z.string().uuid(), cariId: z.string().uuid(), faturaId: z.string().uuid().optional(), tutar: tutarSemasi,
  /** P1-6: faturanın açık bağlantısı varsa önce onu iptal et. */
  oncekiniIptalEt: z.boolean().optional(),
});
export const posTahsilatListeSemasi = z.object({ durum: z.enum(["baslatildi", "odendi", "basarisiz", "iptal", "suresi_doldu"]).optional(), arama: z.string().trim().max(100).optional(), posHesapId: z.string().uuid().optional(), sayfa: z.coerce.number().int().min(1).default(1), adet: z.coerce.number().int().min(10).max(100).default(25) });
/** P1-6 */
export const posNedenSemasi = z.object({ neden: nedenSemasi });
export const posSlipSemasi = z.object({
  posHesapId: z.string().uuid(), cariId: z.string().uuid(), faturaId: z.string().uuid().optional().nullable(), tutar: tutarSemasi,
  tarih: z.string().date("Geçersiz tarih (YYYY-AA-GG)"), slipNo: z.string().trim().max(50).optional().nullable(), aciklama: z.string().trim().max(500).optional().nullable(),
  /** KSB-36 */
  taksitSayisi: z.number().int().min(1).max(12).optional(),
});
export const posIadeSemasi = z.object({ tutar: tutarSemasi, tarih: z.string().date("Geçersiz tarih (YYYY-AA-GG)"), neden: nedenSemasi });
