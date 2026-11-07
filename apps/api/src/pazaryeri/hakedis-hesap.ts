import { Prisma } from "@prisma/client";

/** PZR-13: hakediş önerisindeki kalem (sipariş faturası ya da kesinti). */
export interface HakedisKalemi { id: string; tarih: Date; tutar: Prisma.Decimal.Value }

/**
 * PZR-13 öneri: pazaryeri ödemeyi dönem dönem yapar; dönem, son ödemeden bu
 * yana biriken siparişler ve kesintilerdir. Ödeme tarihine kadarki her
 * kesim tarihi için net (Σ sipariş − Σ kesinti) hesaplanır, banka tutarına en
 * yakın kesim seçilir (eşitlikte daha geç tarih). Kullanıcı öneriyi düzeltir.
 */
export function hakedisOnerisi(siparisler: readonly HakedisKalemi[], kesintiler: readonly HakedisKalemi[], bankaTutari: Prisma.Decimal.Value): { siparisIds: string[]; kesintiIds: string[]; net: string; fark: string } {
  const banka = new Prisma.Decimal(bankaTutari);
  const tarihler = [...new Set([...siparisler, ...kesintiler].map((k) => k.tarih.getTime()))].sort((a, b) => a - b);
  let enIyi: { sinir: number; net: Prisma.Decimal } | null = null;
  for (const sinir of tarihler) {
    const net = siparisler.filter((s) => s.tarih.getTime() <= sinir).reduce((t, s) => t.add(s.tutar), new Prisma.Decimal(0))
      .sub(kesintiler.filter((k) => k.tarih.getTime() <= sinir).reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(0)));
    if (!enIyi || net.sub(banka).abs().lte(enIyi.net.sub(banka).abs())) enIyi = { sinir, net };
  }
  if (!enIyi) return { siparisIds: [], kesintiIds: [], net: "0.00", fark: banka.neg().toFixed(2) };
  const sinir = enIyi.sinir;
  return {
    siparisIds: siparisler.filter((s) => s.tarih.getTime() <= sinir).map((s) => s.id),
    kesintiIds: kesintiler.filter((k) => k.tarih.getTime() <= sinir).map((k) => k.id),
    net: enIyi.net.toFixed(2),
    fark: enIyi.net.sub(banka).toFixed(2),
  };
}
