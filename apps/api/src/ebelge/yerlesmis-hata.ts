import type { Prisma } from "@prisma/client";

/**
 * Yerleşmiş gönderim hatası (EBLG-46).
 *
 * Gönderim işi düşünce kayıt hemen `hata` yazılır, ama kuyruk işi üstel
 * beklemeyle birkaç kez daha dener; ikinci denemede geçen bir gönderim de
 * arada `hata` görünür. Düzeltme taraması tam o aralığa denk gelirse kritik
 * bir düzeltme kaydı ve "e-Belge gönderimi hata verdi" e-postası üretir,
 * gönderim sonra başarılı olunca kayıt sessizce çözülür — e-posta geri
 * alınamaz. Bu yüzden `hata` durumu ancak denemeler bittikten sonra, kayda
 * bu süre boyunca dokunulmamışsa gerçek bir bulgu sayılır: her başarısız
 * deneme `updatedAt`'i tazelediği için denemeler sürerken süre baştan başlar.
 *
 * Eşik kuyruğun toplam yeniden deneme penceresinden (5 deneme, 5 sn'den üstel
 * bekleme ≈ 75 sn) belirgin biçimde uzun tutulur.
 */
export const HATA_YERLESME_MS = Number(process.env.EBLG_HATA_YERLESME_MS || 5 * 60 * 1_000);

export function yerlesmisHataMi(kayit: { durum: string; updatedAt: Date }, simdi = Date.now()): boolean {
  return kayit.durum === "hata" && simdi - kayit.updatedAt.getTime() >= HATA_YERLESME_MS;
}

export function yerlesmisHataKosulu(simdi = Date.now()): Prisma.EbelgeKayitWhereInput {
  return { durum: "hata", updatedAt: { lte: new Date(simdi - HATA_YERLESME_MS) } };
}
