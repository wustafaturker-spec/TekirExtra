import { z } from "zod";

/** CARI-41: cari grubu (holding / ana firma). */
export const cariGrupSemasi = z.object({
  ad: z.string().trim().min(1, "Grup adı zorunludur").max(120),
  /** TL; boş/null limitsiz. */
  riskLimiti: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Risk limiti 0 ya da pozitif tutar olmalıdır").nullable().optional(),
  notlar: z.string().max(1000).nullable().optional(),
});

export type CariGrupGirdisi = z.infer<typeof cariGrupSemasi>;
