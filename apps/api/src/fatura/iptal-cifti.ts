import type { Prisma } from "@prisma/client";

/**
 * İptal edilmiş faturanın cari ve stok hareketlerini üreten kaynak türleri
 * (CARI-22, STK-22): faturanın kendi hareketi, iptalin ters hareketi ve ters
 * hareketin telafisi; taslağa geri alınıp yeniden kesinleştirilmiş faturada
 * geri almanın ters hareketi de (FTR-29). Hepsinin `kaynakRef`'i fatura kimliğidir ve toplamları
 * sıfırdır; bu yüzden birlikte gizlendiklerinde bakiye değişmez.
 */
export const IPTAL_CIFTI_KAYNAKLARI: readonly string[] = ["fatura", "fatura_iptal", "fatura_iptal_duzeltme", "fatura_geri_alma"];

interface KaynakliHareket {
  kaynakTur: string;
  kaynakRef: string | null;
}

const faturaKaynakli = (h: KaynakliHareket) => Boolean(h.kaynakRef) && IPTAL_CIFTI_KAYNAKLARI.includes(h.kaynakTur);

/** Hareketlerin bağlı olduğu faturalardan iptal edilmiş olanların kimlikleri. */
export async function iptalEdilmisFaturalar(tx: Prisma.TransactionClient, hareketler: KaynakliHareket[]): Promise<Set<string>> {
  const refler = [...new Set(hareketler.filter(faturaKaynakli).map((h) => h.kaynakRef!))];
  if (refler.length === 0) return new Set();
  const faturalar = await tx.fatura.findMany({ where: { id: { in: refler }, durum: "iptal" }, select: { id: true } });
  return new Set(faturalar.map((f) => f.id));
}

/** Hareket, iptal edilmiş bir faturanın hareketi mi? */
export function iptalCiftiMi(h: KaynakliHareket, iptaller: Set<string>): boolean {
  return faturaKaynakli(h) && iptaller.has(h.kaynakRef!);
}

export interface GeriAlmaHareketi extends KaynakliHareket { id: string; createdAt: Date }

/**
 * CARI-63/STK-42: taslağa geri alınmış kesinleştirmenin hareketi ile ters
 * hareketi. Her geri alma o andaki son kesinleştirmeyi çevirir; yani bir
 * faturada N geri alma varsa ilk N kesinleştirme hareketi çevrilmiştir, son
 * kesinleştirme açık kalır. Çift aynı tarihte olduğundan tarih penceresi
 * bölemez. `anahtar`: stokta fatura + ürün (eski hizmet hareketleri çevrilmez).
 */
export function geriAlinanHareketler<T extends GeriAlmaHareketi>(hareketler: T[], anahtar: (h: T) => string = (h) => h.kaynakRef!): Set<string> {
  const gruplar = new Map<string, { kesin: T[]; ters: T[] }>();
  for (const h of hareketler) {
    if (!h.kaynakRef || (h.kaynakTur !== "fatura" && h.kaynakTur !== "fatura_geri_alma")) continue;
    const g = gruplar.get(anahtar(h)) ?? { kesin: [], ters: [] };
    (h.kaynakTur === "fatura" ? g.kesin : g.ters).push(h);
    gruplar.set(anahtar(h), g);
  }
  const sonuc = new Set<string>();
  for (const { kesin, ters } of gruplar.values()) {
    if (!ters.length) continue;
    for (const h of ters) sonuc.add(h.id);
    for (const h of [...kesin].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, ters.length)) sonuc.add(h.id);
  }
  return sonuc;
}

/** Sorgu parametresi (`iptaller=1`) iptallerin gösterilmesini istiyor mu? */
export function iptalleriGoster(deger: unknown): boolean {
  return deger === true || deger === "1" || deger === "true";
}
