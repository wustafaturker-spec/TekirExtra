import type { Prisma } from "@prisma/client";

/**
 * İptal edilmiş faturanın cari ve stok hareketlerini üreten kaynak türleri
 * (CARI-22, STK-22): faturanın kendi hareketi, iptalin ters hareketi ve ters
 * hareketin telafisi. Hepsinin `kaynakRef`'i fatura kimliğidir ve toplamları
 * sıfırdır; bu yüzden birlikte gizlendiklerinde bakiye değişmez.
 */
export const IPTAL_CIFTI_KAYNAKLARI: readonly string[] = ["fatura", "fatura_iptal", "fatura_iptal_duzeltme"];

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

/** Sorgu parametresi (`iptaller=1`) iptallerin gösterilmesini istiyor mu? */
export function iptalleriGoster(deger: unknown): boolean {
  return deger === true || deger === "1" || deger === "true";
}
