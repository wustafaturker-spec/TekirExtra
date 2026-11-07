import { Prisma } from "@prisma/client";

/** PZR-07: eşleştirmede kabul edilen kuruş farkı. */
export const ESLESME_TOLERANSI = new Prisma.Decimal("0.01");
/** PZR-07: "kesildi ama faturası gelmedi" sayılması için kesinti tarihinden geçen gün. */
export const FATURA_BEKLEME_GUN = 45;

export interface AdayKesinti { id: string; tarih: Date; tutar: Prisma.Decimal.Value }

/**
 * PZR-07 eşleştirme önerisi: faturanın tutarı, fatura tarihine kadarki faturalı
 * bekleyen kesintilerin **tarih sırasında ardışık** bir diliminin toplamıyla
 * (kuruş toleransı) aranır. Pazaryerleri komisyon faturasını dönem dönem
 * keser; dönem içindeki kesintiler ardışıktır. En yakın tarihli dilim önce
 * denenir. Bulunamazsa null (kullanıcı elle seçer).
 */
export function eslesmeOnerisi(fatura: { tarih: Date; toplam: Prisma.Decimal.Value }, adaylar: readonly AdayKesinti[]): { kesintiIds: string[]; toplam: string } | null {
  const hedef = new Prisma.Decimal(fatura.toplam);
  if (hedef.lte(0)) return null;
  const sirali = adaylar.filter((k) => k.tarih.getTime() <= fatura.tarih.getTime()).sort((a, b) => a.tarih.getTime() - b.tarih.getTime() || a.id.localeCompare(b.id));
  for (let son = sirali.length - 1; son >= 0; son--) {
    let toplam = new Prisma.Decimal(0);
    for (let bas = son; bas >= 0; bas--) {
      toplam = toplam.add(sirali[bas].tutar);
      if (toplam.sub(hedef).abs().lte(ESLESME_TOLERANSI)) return { kesintiIds: sirali.slice(bas, son + 1).map((k) => k.id), toplam: toplam.toFixed(2) };
      if (toplam.gt(hedef.add(ESLESME_TOLERANSI))) break;
    }
  }
  return null;
}

/** PZR-07: gelen e-Fatura gönderen ünvanından pazaryeri tahmini (VKN önerisi; uydurma numara yok). */
const UNVAN_KALIPLARI: Record<string, RegExp> = {
  amazon_tr: /amazon/i,
  trendyol: /trendyol|dsm grup/i,
  hepsiburada: /hepsiburada|d[-\s]?market/i,
  n11: /\bn11\b|n11\.com/i,
};
export function unvanPazaryerineUyar(saglayici: string, unvan: string): boolean {
  return UNVAN_KALIPLARI[saglayici]?.test(unvan) ?? false;
}

export function vknGecerli(vkn: string): boolean {
  return /^\d{10,11}$/.test(vkn);
}
