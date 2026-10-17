import type { Prisma } from "@prisma/client";
import { iptalEdilmisFaturalar } from "../fatura/iptal-cifti";
import { anlikTahmin, faturaNetHareketleri, gerceklesenGecikmeler, type Guven, type IsabetSatiri, type KaynakliHareket, type TahminKaynagi } from "./tahmin-isabeti";

/** Bir okumada geriye dönük tahmini üretilecek en çok fatura; kalanı sonraki okumalarda. */
const GERIYE_DONUK_PARCA = 2000;

type Tx = Prisma.TransactionClient;

async function cariHareketleri(tx: Tx, cariIdler: string[]): Promise<Map<string, KaynakliHareket[]>> {
  const satirlar = await tx.cariHareket.findMany({
    where: { cariId: { in: cariIdler } },
    select: { cariId: true, tip: true, tutarTry: true, tarih: true, vadeTarihi: true, kaynakTur: true, kaynakRef: true },
    orderBy: { tarih: "asc" },
  });
  const sonuc = new Map<string, KaynakliHareket[]>();
  for (const s of satirlar) {
    sonuc.set(s.cariId, [...(sonuc.get(s.cariId) ?? []), { tip: s.tip as "borc" | "alacak", tutarTry: Number(s.tutarTry), tarih: s.tarih, vadeTarihi: s.vadeTarihi, kaynakTur: s.kaynakTur, kaynakRef: s.kaynakRef }]);
  }
  return sonuc;
}

/**
 * CARI-49: satış faturası kesinleşirken o anki tahmini kaydeder. Faturanın
 * cari hareketi yazılmadan önce çağrılır; tahmin ekranın gösterdiğiyle aynıdır.
 * Taslağa geri alınıp yeniden kesinleşmede ilk tahmin korunur.
 */
export async function kesinlesmeTahminiYaz(tx: Tx, tenantId: string, fatura: { id: string; cariId: string }, riskLimiti: number | null, an = new Date()) {
  const hareketler = (await cariHareketleri(tx, [fatura.cariId])).get(fatura.cariId) ?? [];
  const t = anlikTahmin(hareketler, fatura.id, an, riskLimiti);
  await tx.faturaGecikmeTahmini.createMany({
    data: [{ tenantId, faturaId: fatura.id, cariId: fatura.cariId, tahminGun: t.tahminGun, guven: t.guven, kapananBorcSayisi: t.kapananBorcSayisi, kaynak: "kesinlesme" }],
    skipDuplicates: true,
  });
}

/**
 * Kaydı olmayan kesin satış faturaları için tahmini fatura tarihindeki
 * hareketlerle geriye dönük üretir (kaynak "geriye_donuk", ekranda yaklaşık).
 */
export async function eksikTahminleriTamamla(tx: Tx, tenantId: string, cariId?: string) {
  const eksikler = await tx.fatura.findMany({
    where: { tip: "satis", durum: "kesin", gecikmeTahmini: { is: null }, ...(cariId ? { cariId } : {}) },
    select: { id: true, cariId: true, tarih: true, cari: { select: { riskLimiti: true } } },
    orderBy: { tarih: "asc" },
    take: GERIYE_DONUK_PARCA,
  });
  if (!eksikler.length) return;
  const hareketler = await cariHareketleri(tx, [...new Set(eksikler.map((f) => f.cariId))]);
  await tx.faturaGecikmeTahmini.createMany({
    data: eksikler.map((f) => {
      const t = anlikTahmin(hareketler.get(f.cariId) ?? [], f.id, f.tarih, f.cari.riskLimiti === null ? null : Number(f.cari.riskLimiti));
      return { tenantId, faturaId: f.id, cariId: f.cariId, tahminGun: t.tahminGun, guven: t.guven, kapananBorcSayisi: t.kapananBorcSayisi, kaynak: "geriye_donuk" };
    }),
    skipDuplicates: true,
  });
}

/** Tahmini olan kesin satış faturaları ve gerçekleşen gecikmeleri (FIFO, net fatura hareketleri). */
export async function isabetSatirlari(tx: Tx, cariId?: string): Promise<IsabetSatiri[]> {
  const tahminler = await tx.faturaGecikmeTahmini.findMany({
    where: { fatura: { durum: "kesin" }, ...(cariId ? { cariId } : {}) },
    select: { faturaId: true, cariId: true, tahminGun: true, guven: true, kaynak: true },
  });
  if (!tahminler.length) return [];
  const hareketler = await cariHareketleri(tx, [...new Set(tahminler.map((t) => t.cariId))]);
  const iptaller = await iptalEdilmisFaturalar(tx, [...hareketler.values()].flat());
  const gerceklesen = new Map<string, ReturnType<typeof gerceklesenGecikmeler>>();
  for (const [c, liste] of hareketler) gerceklesen.set(c, gerceklesenGecikmeler(faturaNetHareketleri(liste, iptaller)));
  return tahminler.map((t) => ({
    faturaId: t.faturaId, cariId: t.cariId, tahminGun: t.tahminGun, guven: t.guven as Guven | null, kaynak: t.kaynak as TahminKaynagi,
    gerceklesen: gerceklesen.get(t.cariId)?.get(t.faturaId),
  }));
}
