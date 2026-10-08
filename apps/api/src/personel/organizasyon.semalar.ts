import { z } from "zod";
const kod = z.string().trim().min(2).max(32).regex(/^[a-z0-9_]+$/, "Kod küçük harf, rakam ve alt çizgi içerebilir");
/** SGK işyeri sicil no: 26 hane (rakam; ara kod harf içerebileceği için harf-rakam kabul edilir). */
const sgkSicil = z.string().trim().transform((v) => v.replace(/[\s.-]/g, "")).pipe(z.string().regex(/^[0-9A-Za-z]{20,30}$/, "SGK sicil no 20–30 karakter olmalıdır")).optional().nullable().or(z.literal(""));
/** PRS-23: ÇSGB işkolu 1–28; boş = bilinmiyor (XML'e 0 yazılır). */
const csgbIsKolu = z.coerce.number().int().min(1, "İşkolu 1–28 arasında olmalıdır").max(28, "İşkolu 1–28 arasında olmalıdır").optional().nullable();
export const isyeriOlusturSemasi = z.object({ kod, ad: z.string().trim().min(2).max(100), adres: z.string().trim().max(500).optional().nullable(), sgkSicilNo: sgkSicil, csgbIsKolu });
export const departmanOlusturSemasi = z.object({ isyeriId: z.string().uuid(), ustDepartmanId: z.string().uuid().optional().nullable(), kod, ad: z.string().trim().min(2).max(100) });
export const pozisyonOlusturSemasi = z.object({ departmanId: z.string().uuid().optional().nullable(), kod, ad: z.string().trim().min(2).max(100) });
export const personelOrganizasyonAtaSemasi = z.object({ isyeriId: z.string().uuid(), departmanId: z.string().uuid().optional().nullable(), pozisyonId: z.string().uuid().optional().nullable(), yoneticiId: z.string().uuid().optional().nullable() });

/** PRS-13 (P2-1): düzenleme; kod değişmez. aktif=false pasife alır. */
export const isyeriGuncelleSemasi = z.object({ ad: z.string().trim().min(2).max(100).optional(), adres: z.string().trim().max(500).optional().nullable(), sgkSicilNo: sgkSicil, csgbIsKolu, aktif: z.boolean().optional() });
export const departmanGuncelleSemasi = z.object({ ad: z.string().trim().min(2).max(100).optional(), ustDepartmanId: z.string().uuid().optional().nullable(), aktif: z.boolean().optional() });
export const pozisyonGuncelleSemasi = z.object({ ad: z.string().trim().min(2).max(100).optional(), departmanId: z.string().uuid().optional().nullable(), aktif: z.boolean().optional() });
