import { z } from "zod";
const kod = z.string().trim().min(2).max(32).regex(/^[a-z0-9_]+$/, "Kod küçük harf, rakam ve alt çizgi içerebilir");
export const isyeriOlusturSemasi = z.object({ kod, ad: z.string().trim().min(2).max(100), adres: z.string().trim().max(500).optional().nullable() });
export const departmanOlusturSemasi = z.object({ isyeriId: z.string().uuid(), ustDepartmanId: z.string().uuid().optional().nullable(), kod, ad: z.string().trim().min(2).max(100) });
export const pozisyonOlusturSemasi = z.object({ departmanId: z.string().uuid().optional().nullable(), kod, ad: z.string().trim().min(2).max(100) });
export const personelOrganizasyonAtaSemasi = z.object({ isyeriId: z.string().uuid(), departmanId: z.string().uuid().optional().nullable(), pozisyonId: z.string().uuid().optional().nullable(), yoneticiId: z.string().uuid().optional().nullable() });
