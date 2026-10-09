import type { Prisma } from "@prisma/client";

/** MVZ-13: merkezde tutulan kanuni süre ve eşikler (`kanuni_deger` türü). */
export type KanuniDegerAnahtari = "babs_esigi" | "earsiv_iptal_gun" | "irsaliye_fatura_gun" | "tevkifat_alt_siniri";

/**
 * Belge tarihinde (ya da verilen günde) yürürlükteki kanuni değer. Kiracı
 * ayarı değildir; platform ekibi Mevzuat Merkezi'nden yönetir. Merkezde kayıt
 * yoksa (ilk dolumdan önceki ortam, birim testi) `varsayilan` döner.
 * Uygulama bağlantısı bu tabloyu okuyabilir; kiracı işlemi içinden de çağrılır.
 */
export async function kanuniDegerOku(
  db: Pick<Prisma.TransactionClient, "mevzuatKayit">,
  anahtar: KanuniDegerAnahtari,
  tarih: Date | string,
  varsayilan: number,
): Promise<number> {
  // Birim testlerinin sahte işlemlerinde tablo yoktur; gerçek bağlantıda her zaman vardır.
  if (!db?.mevzuatKayit) return varsayilan;
  const gun = new Date(typeof tarih === "string" ? `${tarih.slice(0, 10)}T00:00:00Z` : tarih.toISOString().slice(0, 10) + "T00:00:00Z");
  const kayit = await db.mevzuatKayit.findFirst({
    where: { tur: "kanuni_deger", anahtar, yururlukBaslangic: { lte: gun }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: gun } }] },
    orderBy: { yururlukBaslangic: "desc" },
    select: { deger: true },
  });
  const deger = (kayit?.deger as { deger?: unknown } | null)?.deger;
  return typeof deger === "number" && Number.isFinite(deger) && deger >= 0 ? deger : varsayilan;
}
