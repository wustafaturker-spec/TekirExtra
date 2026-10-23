import type { Prisma } from "@prisma/client";

/** MVZ-13: merkezde tutulan kanuni süre ve eşikler (`kanuni_deger` türü). */
export type KanuniDegerAnahtari =
  | "babs_esigi" | "earsiv_iptal_gun" | "irsaliye_fatura_gun" | "tevkifat_alt_siniri" | "kidem_tavani"
  | "dogrudan_gider_siniri" | "binek_amortisman_siniri" | "binek_amortisman_siniri_vergili";

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

/**
 * Kıdem tazminatı tavanı (1475 s. K. m.14) memur maaş katsayısına bağlı olarak
 * Ocak ve Temmuz'da değişir. Kayıt yalnız başladığı yarıyılda geçerlidir: yeni
 * dönemin tavanı yayınlanmadıysa eski tavan kullanılmaz, `null` döner.
 */
export async function kidemTavaniOku(db: Pick<Prisma.TransactionClient, "mevzuatKayit">, tarih: Date): Promise<number | null> {
  const gun = new Date(`${tarih.toISOString().slice(0, 10)}T00:00:00Z`);
  const yariyilBasi = new Date(Date.UTC(gun.getUTCFullYear(), gun.getUTCMonth() < 6 ? 0 : 6, 1));
  const kayit = await db.mevzuatKayit.findFirst({
    where: { tur: "kanuni_deger", anahtar: "kidem_tavani", yururlukBaslangic: { lte: gun, gte: yariyilBasi }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: gun } }] },
    orderBy: { yururlukBaslangic: "desc" },
    select: { deger: true },
  });
  const deger = (kayit?.deger as { deger?: unknown } | null)?.deger;
  return typeof deger === "number" && Number.isFinite(deger) && deger > 0 ? deger : null;
}

/**
 * DMR-03/06: yıllık tutarlar (VUK 313 doğrudan gider, GVK 40/5 binek oto sınırı)
 * yalnız başladıkları takvim yılına uygulanır; o yılın kaydı yoksa `null` döner
 * (önceki yılın tutarı kullanılmaz).
 */
export async function yillikDegerOku(db: Pick<Prisma.TransactionClient, "mevzuatKayit">, anahtar: KanuniDegerAnahtari, yil: number): Promise<number | null> {
  if (!db?.mevzuatKayit) return null;
  const kayit = await db.mevzuatKayit.findFirst({
    where: { tur: "kanuni_deger", anahtar, yururlukBaslangic: { gte: new Date(Date.UTC(yil, 0, 1)), lte: new Date(Date.UTC(yil, 11, 31)) } },
    orderBy: { yururlukBaslangic: "desc" },
    select: { deger: true },
  });
  const deger = (kayit?.deger as { deger?: unknown } | null)?.deger;
  return typeof deger === "number" && Number.isFinite(deger) && deger > 0 ? deger : null;
}
