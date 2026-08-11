import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const bankaWebhookSemasi = z.object({
  hareketler: z.array(z.object({
    id: z.string().min(1).max(200),
    tarih: z.iso.date(),
    tutar: z.coerce.number().finite().refine((x) => x !== 0, "Tutar sıfır olamaz"),
    aciklama: z.string().min(1).max(500),
    dekontNo: z.string().max(100).optional(),
    karsiIban: z.string().max(34).optional(),
    karsiUnvan: z.string().max(200).optional(),
    bakiye: z.coerce.number().finite().optional(),
  })).min(1).max(500),
});

export type BankaWebhookGirdisi = z.infer<typeof bankaWebhookSemasi>;

export function anahtarEslesir(beklenen: string, verilen: string): boolean {
  const a = createHash("sha256").update(beklenen).digest();
  const b = createHash("sha256").update(verilen).digest();
  return timingSafeEqual(a, b);
}
