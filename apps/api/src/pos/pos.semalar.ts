import { z } from "zod";
export const posTahsilatBaslatSemasi = z.object({ posHesapId: z.string().uuid(), cariId: z.string().uuid(), faturaId: z.string().uuid().optional(), tutar: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((x) => Number(x) > 0, "Tutar pozitif olmalıdır") });
