import { z } from "zod";

export const donemSecimSemasi = z.object({ yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12) });
export const donemKapatSemasi = donemSecimSemasi.extend({ gerekce: z.string().trim().min(10).max(500) });
export const donemAcSemasi = z.object({ gerekce: z.string().trim().min(10).max(500), totpKodu: z.string().regex(/^\d{6}$/, "TOTP kodu 6 haneli olmalıdır") });
