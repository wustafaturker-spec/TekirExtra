import { z } from "zod";
import { belgeOlusturSemasi } from "../belgeler/belgeler.semalar";
export const CRM_BELGE_MODULU = "crm_belge_baglari";
export const crmBelgeAyariSemasi = z.object({ surum: z.literal(1).default(1), mod: z.enum(["kapali", "salt_okunur", "pilot", "acik"]).default("kapali") }).strict();
const uuid = z.uuid().transform(s => s.toLowerCase());
const gerekce = z.string().trim().min(2).max(500);
export const crmBelgeBaglaSemasi = z.object({ belgeId: uuid, istekAnahtari: uuid, gerekce, beklenenFirsatZamani: z.iso.datetime().transform(s => new Date(s).toISOString()), beklenenBelgeZamani: z.iso.datetime().transform(s => new Date(s).toISOString()) }).strict();
export const crmBelgeCozSemasi = z.object({ istekAnahtari: uuid, gerekce, beklenenSurum: z.literal(1) }).strict();
export const crmBelgeAdaySemasi = z.object({ arama: z.string().trim().max(100).default(""), imlec: uuid.optional() }).strict();
export const crmKapamaPayiSemasi=z.object({kapamaId:uuid,istekAnahtari:uuid,gerekce,beklenenSurum:z.number().int().min(0).max(199),kanitOzeti:z.string().regex(/^[a-f0-9]{64}$/),kaynakOzeti:z.string().regex(/^[a-f0-9]{64}$/),tutar:z.string().regex(/^\d{1,13}(\.\d{1,2})?$/)}).strict();
export const crmIadePayiSemasi=z.object({iadeFaturaId:uuid,istekAnahtari:uuid,gerekce,beklenenSurum:z.number().int().min(0).max(199),kanitOzeti:z.string().regex(/^[a-f0-9]{64}$/),matrah:z.string().regex(/^\d{1,13}(\.\d{1,2})?$/)}).strict();
export const crmTeklifOlusturSemasi = z.object({
 istekAnahtari: uuid, gerekce,
 beklenenFirsatZamani: z.iso.datetime().transform(s => new Date(s).toISOString()),
 belge: belgeOlusturSemasi.extend({ tur: z.literal("teklif"), yon: z.literal("satis"), faturaId: z.null().optional() }).strict(),
}).strict();
