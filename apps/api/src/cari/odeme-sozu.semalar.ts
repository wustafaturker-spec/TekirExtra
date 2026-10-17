import { Prisma } from "@prisma/client";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";
import { z } from "zod";

const uuid = z.uuid().transform((v) => v.toLowerCase());
const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Geçersiz söz tarihi");
const icerik = {
  tutar: z.string().regex(/^(0|[1-9]\d{0,12})\.\d{2}$/).refine((v) => new Prisma.Decimal(v).gt(0), "Söz tutarı pozitif olmalı"),
  sozTarihi: gun,
  aciklama: z.string().trim().min(2).max(2000),
  istekAnahtari: uuid,
};
export const odemeSozuOlusturSemasi = z.object({ ...icerik, cariId: uuid, faturaId: uuid, dovizCinsi: z.enum(DOVIZ_CINSLERI) }).strict();
export const odemeSozuRevizeSemasi = z.object({ ...icerik, beklenenSurum: z.number().int().positive(), gerekce: z.string().trim().min(2).max(2000) }).strict();
export const odemeSozuIptalSemasi = z.object({ beklenenSurum: z.number().int().positive(), gerekce: z.string().trim().min(2).max(2000) }).strict();
export const odemeSozuListeSemasi = z.object({ cariId: uuid }).strict();
export type OdemeSozuOlustur = z.infer<typeof odemeSozuOlusturSemasi>;
export type OdemeSozuRevize = z.infer<typeof odemeSozuRevizeSemasi>;
export type OdemeSozuIptal = z.infer<typeof odemeSozuIptalSemasi>;
