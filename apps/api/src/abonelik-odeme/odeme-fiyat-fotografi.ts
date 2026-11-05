import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ABONELIK_KDV_ORANI, type AbonelikTutari } from "./abonelik-tutari";

const para = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
const ortak = z.object({
  planKodu: z.string().min(1).max(40), planAdi: z.string().min(1).max(100),
  paraBirimi: z.literal("TRY"), kdvOrani: z.string().regex(/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/),
  aySayisi: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  matrah: para, kdv: para, toplam: para,
}).strict();
const sema = z.discriminatedUnion("semaSurumu", [
  ortak.extend({ semaSurumu: z.literal(1), kaynak: z.literal("eski_sabit") }),
  ortak.extend({ semaSurumu: z.literal(2), kaynak: z.enum(["eski_plan_gecisi", "katalog_atamasi"]), paketSurumId: z.uuid() }),
]);
export type OdemeFiyatFotografi = z.infer<typeof sema>;

/** Bağlı sürümün korunmuş koşullarını kaydeder; katalog yayınını fiyat geçişi saymaz. */
export function odemeFiyatFotografi(t: AbonelikTutari): OdemeFiyatFotografi {
  return fiyatFotografiniOku({
    ...(t.paketSurumId ? { semaSurumu: 2, kaynak: t.fiyatKaynagi ?? "eski_plan_gecisi", paketSurumId: t.paketSurumId } : { semaSurumu: 1, kaynak: "eski_sabit" }), planKodu: t.planKodu, planAdi: t.planAdi,
    paraBirimi: "TRY", kdvOrani: t.kdvOrani ?? String(ABONELIK_KDV_ORANI), aySayisi: t.aySayisi,
    matrah: t.matrah.toFixed(2), kdv: t.kdv.toFixed(2), toplam: t.toplam.toFixed(2),
  });
}

/** Bozuk fotoğraf güncel paket/vergiyle sessizce yeniden hesaplanmaz. */
export function fiyatFotografiniOku(veri: unknown): OdemeFiyatFotografi {
  const r = sema.safeParse(veri);
  if (!r.success) throw new Error("Ödemenin fiyat fotoğrafı geçersiz.");
  const f = r.data;
  const kdv = new Prisma.Decimal(f.matrah).mul(f.kdvOrani).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (new Prisma.Decimal(f.kdvOrani).gt(100) || !kdv.eq(f.kdv) || !new Prisma.Decimal(f.matrah).add(f.kdv).eq(f.toplam)) {
    throw new Error("Ödemenin fiyat fotoğrafında tutar veya KDV uyuşmuyor.");
  }
  return f;
}

export function fiyatFotografiniDogrula(veri: unknown, kayit: { aySayisi: number; matrah: Prisma.Decimal | null; kdv: Prisma.Decimal | null; toplam: Prisma.Decimal; planKodu?: string }) {
  const f = fiyatFotografiniOku(veri);
  if (f.aySayisi !== kayit.aySayisi || !kayit.matrah?.eq(f.matrah) || !kayit.kdv?.eq(f.kdv) || !kayit.toplam.eq(f.toplam)
    || (kayit.planKodu !== undefined && f.planKodu !== kayit.planKodu)) {
    throw new Error("Fiyat fotoğrafı ödeme kaydıyla uyuşmuyor.");
  }
  return f;
}
