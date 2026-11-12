import { Prisma } from "@prisma/client";

/** SAH-05: saha ekranının cihaza aldığı ürün listesi; fiyat ve maliyet yoktur. */
export interface SahaUrunu {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  takipTipi: string;
  varyantlar: Array<{ id: string; kod: string; ad: string }>;
}
/** Barkod → ürün (varyant) ve ana birime çevirme katsayısı (koli barkodu 12 gibi). */
export interface SahaBarkodu { barkod: string; stokId: string; varyantId: string | null; katsayi: number; birim: string }

export async function sahaUrunleri(tx: Prisma.TransactionClient): Promise<{ urunler: SahaUrunu[]; barkodlar: SahaBarkodu[] }> {
  const [kartlar, ekBarkodlar, birimler] = await Promise.all([
    tx.stokKart.findMany({
      where: { aktif: true, tip: { not: "hizmet" } }, orderBy: { kod: "asc" },
      select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true, barkod: true, varyantlar: { where: { aktif: true }, orderBy: { kod: "asc" }, select: { id: true, kod: true, ad: true, barkod: true } } },
    }),
    tx.stokBarkod.findMany({ select: { barkod: true, stokId: true, birim: true } }),
    tx.stokBirim.findMany({ select: { stokId: true, ad: true, katsayi: true } }),
  ]);
  const kartMap = new Map(kartlar.map((k) => [k.id, k]));
  const katsayi = new Map(birimler.map((b) => [`${b.stokId}|${b.ad}`, Number(b.katsayi)]));
  const barkodlar: SahaBarkodu[] = [];
  const goruldu = new Set<string>();
  const ekle = (b: SahaBarkodu) => { if (!b.barkod || goruldu.has(b.barkod)) return; goruldu.add(b.barkod); barkodlar.push(b); };
  // Öncelik barkod aramasıyla (STK-15) aynı: tanımlı barkod kaydı, sonra kart barkodu; varyant barkodu varyantı bulur.
  for (const b of ekBarkodlar) {
    const k = kartMap.get(b.stokId);
    if (!k) continue;
    const kat = b.birim && b.birim !== k.anaBirim ? katsayi.get(`${k.id}|${b.birim}`) : 1;
    if (!kat || !(kat > 0)) continue;
    ekle({ barkod: b.barkod, stokId: k.id, varyantId: null, katsayi: kat, birim: b.birim ?? k.anaBirim });
  }
  for (const k of kartlar) {
    if (k.barkod) ekle({ barkod: k.barkod, stokId: k.id, varyantId: null, katsayi: 1, birim: k.anaBirim });
    for (const v of k.varyantlar) if (v.barkod) ekle({ barkod: v.barkod, stokId: k.id, varyantId: v.id, katsayi: 1, birim: k.anaBirim });
  }
  return {
    urunler: kartlar.map((k) => ({ id: k.id, kod: k.kod, ad: k.ad, anaBirim: k.anaBirim, takipTipi: k.takipTipi, varyantlar: k.varyantlar.map((v) => ({ id: v.id, kod: v.kod, ad: v.ad })) })),
    barkodlar,
  };
}
