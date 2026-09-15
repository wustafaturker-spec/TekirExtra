import type { Prisma } from "@prisma/client";

/**
 * Yarım kalmış gönderim rezervasyonu (EBLG-37).
 *
 * Gönderim önce kaydı `kuyrukta` yazar, sonucu entegratör çağrısından sonra
 * yazar. Süreç arada ölürse kayıt referanssız `kuyrukta` kalır ve ne durum
 * sorgusu (referans yok) ne de yeniden gönderim (süreç başlamış sayılır) onu
 * kurtarabilir. Bu süre boyunca dokunulmamış böyle bir kayıt yeniden
 * gönderilebilir sayılır; gönderim yeniden denemede önce entegratöre sorduğu
 * için (EBLG-17) mükerrer belge oluşmaz. Süren gönderim işi varsa kuyruk yeni
 * işi zaten eklemez.
 */
export const TAKILI_REZERVASYON_MS = Number(process.env.EBLG_TAKILI_REZERVASYON_MS || 15 * 60 * 1_000);

export function takiliRezervasyonMu(
  kayit: { durum: string; entegratorRef: string | null; updatedAt: Date },
  simdi = Date.now(),
): boolean {
  return kayit.durum === "kuyrukta" && !kayit.entegratorRef && simdi - kayit.updatedAt.getTime() >= TAKILI_REZERVASYON_MS;
}

export function takiliRezervasyonKosulu(simdi = Date.now()): Prisma.EbelgeKayitWhereInput {
  return { durum: "kuyrukta", entegratorRef: null, updatedAt: { lte: new Date(simdi - TAKILI_REZERVASYON_MS) } };
}
