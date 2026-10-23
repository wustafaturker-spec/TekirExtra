import { Prisma } from "@prisma/client";

const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);

export interface BaglanmamisFis {
  id: string;
  cariId: string;
  tarih: Date;
  tip: string;
  dovizCinsi: string;
  tutar: Prisma.Decimal;
  /** Fişin kendi dövizinde faturaya bağlanmamış kalan. */
  kalan: Prisma.Decimal;
  kalanTry: Prisma.Decimal;
  makbuzNo: string | null;
  aciklama: string | null;
}

/** Faturaya bağlanmamış kısmı kalan fişler (girişte faturaya bağlananlar hariç). */
export async function baglanmamisFisler(tx: Prisma.TransactionClient, cariIdler: string[], tip?: "tahsilat" | "tediye"): Promise<BaglanmamisFis[]> {
  if (!cariIdler.length) return [];
  const fisler = await tx.kasaBankaHareket.findMany({
    where: { cariId: { in: cariIdler }, tip: tip ?? { in: ["tahsilat", "tediye"] }, faturaId: null, kaynakTur: { notIn: ["ters_kayit", "acilis"] } },
    orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
    select: { id: true, cariId: true, tarih: true, tip: true, tutar: true, kur: true, dovizCinsi: true, makbuzNo: true, aciklama: true, kapamalar: { select: { tutar: true, kaynakTutari: true } } },
  });
  if (!fisler.length) return [];
  const tersler = await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: fisler.map((f) => f.id) } }, select: { kaynakRef: true, tutar: true } });
  const dusen = new Map<string, Prisma.Decimal>();
  for (const t of tersler) if (t.kaynakRef) dusen.set(t.kaynakRef, (dusen.get(t.kaynakRef) ?? D(0)).add(t.tutar));
  const ham = fisler.map((f) => ({ f, kalan: f.tutar.sub(dusen.get(f.id) ?? 0).sub(f.kapamalar.reduce((t, k) => t.add(k.kaynakTutari ?? k.tutar), D(0))) }))
    .filter((x) => x.kalan.gt(0.005));
  if (!ham.length) return [];
  // Denkleştirme karşı yöndeki kaynakları (ör. cariye ciro edilen çek, ödememiz) kapama yazmadan
  // ödemeden en eskiden düşer (KSB-16 ters yön netleştirmesi). Bağlanmamış tutar bu yüzden carinin
  // o dövizdeki alacaklı (tahsilatta) ya da borçlu (ödemede) bakiyesini aşamaz; kalan en yeni fişlerdedir.
  const bakiyeler = await tx.cariHareket.groupBy({ by: ["cariId", "dovizCinsi", "tip"], where: { cariId: { in: [...new Set(ham.map((x) => x.f.cariId!))] } }, _sum: { tutar: true } });
  const sinir = new Map<string, Prisma.Decimal>();
  for (const b of bakiyeler) {
    const anahtar = `${b.cariId}|${b.dovizCinsi}`;
    // Tahsilat cariyi alacaklandırır; fazla tahsilat alacak − borç kadardır. Ödeme için tersi.
    const isaret = b.tip === "alacak" ? 1 : -1;
    sinir.set(anahtar, (sinir.get(anahtar) ?? D(0)).add(D(b._sum.tutar ?? 0).mul(isaret)));
  }
  const sonuc: BaglanmamisFis[] = [];
  for (const { f, kalan: hamKalan } of [...ham].reverse()) {
    const anahtar = `${f.cariId}|${f.dovizCinsi}`;
    // Tahsilatta artı (alacaklı) bakiye, ödemede eksi (borçlu) bakiye kullanılabilir.
    const yon = f.tip === "tahsilat" ? 1 : -1;
    const kalan = Prisma.Decimal.min(hamKalan, Prisma.Decimal.max((sinir.get(anahtar) ?? D(0)).mul(yon), 0));
    if (!kalan.gt(0.005)) continue;
    sinir.set(anahtar, (sinir.get(anahtar) ?? D(0)).sub(kalan.mul(yon)));
    sonuc.push({
      id: f.id, cariId: f.cariId!, tarih: f.tarih, tip: f.tip, dovizCinsi: f.dovizCinsi, tutar: f.tutar, kalan,
      kalanTry: (f.dovizCinsi === "TRY" ? kalan : kalan.mul(f.kur)).toDecimalPlaces(2), makbuzNo: f.makbuzNo, aciklama: f.aciklama,
    });
  }
  return sonuc.reverse();
}

/**
 * KSB-23: carilerin faturaya bağlanmamış tahsilat (ya da ödeme) tutarı, TL.
 * Girişte faturaya bağlanmamış fişlerden ters kayıtlar ve bütün kapamalar
 * (elle ve otomatik) düşüldükten sonra kalan; fişin kendi kuruyla TL'ye çevrilir.
 * Vadesi geçmiş görünen fatura aslında bu parayla ödenmiş olabilir.
 */
export async function baglanmamisOdemeler(tx: Prisma.TransactionClient, cariIdler: string[], tip: "tahsilat" | "tediye"): Promise<Map<string, Prisma.Decimal>> {
  const sonuc = new Map<string, Prisma.Decimal>();
  for (const f of await baglanmamisFisler(tx, cariIdler, tip)) sonuc.set(f.cariId, (sonuc.get(f.cariId) ?? D(0)).add(f.kalanTry));
  return sonuc;
}
