import { Prisma } from "@prisma/client";
import { iptalCiftiMi, iptalEdilmisFaturalar } from "../fatura/iptal-cifti";
import { yaslandir, type YaslandirmaSonucu } from "./yaslandirma";

/**
 * CARI-30 (karar 2026-10-03): müşteri riski kart ile fatura uyarısında aynı
 * fonksiyondan hesaplanır. Risk = açık TL bakiye (alacaklıysa 0) + tahsil
 * edilmemiş alınan çek/senet: portföyde, tahsile ya da teminata verilmiş;
 * ciro edilmiş olan da vadesinden sonra bu süre dolana kadar (karşılıksız
 * çıkarsa ciro eden olarak geri döner).
 */
export const CIRO_RISK_SURESI_GUN = 30;
const GUN_MS = 86_400_000;
const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

export interface CariRiski {
  bakiyeTry: Prisma.Decimal;
  cekSenetRiski: Prisma.Decimal;
  mevcutRisk: Prisma.Decimal;
}

export async function cariRiskleri(tx: Prisma.TransactionClient, cariIdler: string[], bugun = new Date()): Promise<Map<string, CariRiski>> {
  if (cariIdler.length === 0) return new Map();
  const ciroSiniri = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate()) - CIRO_RISK_SURESI_GUN * GUN_MS);
  const [bakiyeler, cekler] = await Promise.all([
    tx.cariHareket.groupBy({ by: ["cariId", "tip"], where: { cariId: { in: cariIdler } }, _sum: { tutarTry: true } }),
    tx.cekSenet.groupBy({
      by: ["cariId"],
      where: {
        cariId: { in: cariIdler },
        yon: "alinan",
        OR: [
          { durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi"] } },
          { durum: "ciro_edildi", vadeTarihi: { gte: ciroSiniri } },
        ],
      },
      _sum: { tutarTry: true },
    }),
  ]);
  const sonuc = new Map<string, CariRiski>(cariIdler.map((id) => [id, { bakiyeTry: D(0), cekSenetRiski: D(0), mevcutRisk: D(0) }]));
  for (const g of bakiyeler) {
    const r = sonuc.get(g.cariId)!;
    const t = g._sum.tutarTry ?? D(0);
    r.bakiyeTry = g.tip === "borc" ? r.bakiyeTry.add(t) : r.bakiyeTry.sub(t);
  }
  for (const c of cekler) if (c.cariId) sonuc.get(c.cariId)!.cekSenetRiski = c._sum.tutarTry ?? D(0);
  for (const r of sonuc.values()) r.mevcutRisk = Prisma.Decimal.max(r.bakiyeTry, 0).add(r.cekSenetRiski);
  return sonuc;
}

/** Kartın risk özeti: limit tanımlıysa kalan limit ve aşım. */
export function riskOzetiGorunumu(risk: CariRiski, riskLimiti: Prisma.Decimal | null) {
  return {
    cekSenetRiski: risk.cekSenetRiski.toFixed(2),
    mevcutRisk: risk.mevcutRisk.toFixed(2),
    limit: riskLimiti?.toFixed(2) ?? null,
    kalanLimit: riskLimiti ? riskLimiti.sub(risk.mevcutRisk).toFixed(2) : null,
    asim: riskLimiti !== null && risk.mevcutRisk.greaterThan(riskLimiti),
  };
}

/**
 * Cari başına FIFO yaşlandırma (CARI-06/18). İptal edilen faturanın hareket
 * çifti önce düşülür; yoksa iptalin ters hareketi en eski borcu kapatıp
 * vadesi geçmiş tutarı kaydırırdı. Kartın "vadesi geçmiş" bilgisi ve listenin
 * "gecikmiş" süzgeci bu sonucu kullanır.
 */
export async function cariYaslandirmalari(tx: Prisma.TransactionClient, cariIdler: string[], bugun = new Date()): Promise<Map<string, YaslandirmaSonucu>> {
  if (cariIdler.length === 0) return new Map();
  const hareketler = await tx.cariHareket.findMany({
    where: { cariId: { in: cariIdler } },
    select: { cariId: true, tip: true, tutarTry: true, vadeTarihi: true, tarih: true, kaynakTur: true, kaynakRef: true },
  });
  const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
  const gruplar = new Map<string, typeof hareketler>();
  for (const h of hareketler) {
    if (iptalCiftiMi(h, iptaller)) continue;
    const liste = gruplar.get(h.cariId) ?? [];
    liste.push(h);
    gruplar.set(h.cariId, liste);
  }
  return new Map(cariIdler.map((id) => [id, yaslandir((gruplar.get(id) ?? []).map((h) => ({ tip: h.tip, tutarTry: Number(h.tutarTry), vadeTarihi: h.vadeTarihi, tarih: h.tarih })), bugun)]));
}

/** Vadesi geçmiş açık tutar (yaşlandırmanın güncel dışı kısmı). */
export const vadesiGecmis = (y: YaslandirmaSonucu) => Math.round((y.toplam - y.guncel) * 100) / 100;
