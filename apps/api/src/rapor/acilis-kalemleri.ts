import { Prisma } from "@prisma/client";
import { baglanmamisOdemeler } from "../kasa-banka/baglanmamis-odeme";

const D = (d: Prisma.Decimal.Value) => new Prisma.Decimal(d);

export interface AcilisKalemi {
  faturaId: string;
  no: string | null;
  cariId: string;
  cariUnvan: string;
  vadeTarihi: string;
  gecikmeGun: number;
  kalanTry: string;
  tip: "satis" | "alis";
  /** VAK-06: fatura değil, açılış kalemi (devreden açık fatura ya da açılış bakiyesi); bağlantı cari kartınadır. */
  acilis: true;
}

/**
 * VAK-06: vadesi geçmiş açılış kalemleri. Açılış hareketi bir faturaya bağlanmadığı için
 * kapanması kapama kaydından okunamaz; carinin faturaya bağlanmamış ödemeleri (KSB-23)
 * açılış kalemlerini en eski vadeden başlayarak kapatır, kalan vadesi geçmişse listelenir.
 */
export async function vadesiGecmisAcilisKalemleri(tx: Prisma.TransactionClient, tenantId: string, bugunBaslangic: Date): Promise<{ alacaklar: AcilisKalemi[]; borclar: AcilisKalemi[] }> {
  const hareketler: { id: string; cariId: string; tip: "borc" | "alacak"; tutarTry: Prisma.Decimal; vadeTarihi: Date | null; tarih: Date; aciklama: string | null }[] = [];
  let imlec: string | undefined;
  for (;;) {
    const sayfa = await tx.cariHareket.findMany({
      where: { tenantId, kaynakTur: "acilis" },
      orderBy: { id: "asc" }, take: 500, ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
      select: { id: true, cariId: true, tip: true, tutarTry: true, vadeTarihi: true, tarih: true, aciklama: true },
    });
    hareketler.push(...sayfa);
    if (sayfa.length < 500) break;
    imlec = sayfa[sayfa.length - 1].id;
  }
  const gecmis = (h: (typeof hareketler)[number]) => (h.vadeTarihi ?? h.tarih) < bugunBaslangic;
  if (!hareketler.some(gecmis)) return { alacaklar: [], borclar: [] };
  const cariIdler = [...new Set(hareketler.filter(gecmis).map((h) => h.cariId))];
  const [tahsilatlar, tediyeler, cariler] = await Promise.all([
    baglanmamisOdemeler(tx, cariIdler, "tahsilat"),
    baglanmamisOdemeler(tx, cariIdler, "tediye"),
    tx.cariHesap.findMany({ where: { id: { in: cariIdler } }, select: { id: true, unvan: true } }),
  ]);
  const unvan = new Map(cariler.map((c) => [c.id, c.unvan]));
  const alacaklar: AcilisKalemi[] = [], borclar: AcilisKalemi[] = [];
  for (const cariId of cariIdler) {
    for (const tip of ["borc", "alacak"] as const) {
      const kalemler = hareketler.filter((h) => h.cariId === cariId && h.tip === tip).sort((a, b) => (a.vadeTarihi ?? a.tarih).getTime() - (b.vadeTarihi ?? b.tarih).getTime());
      // Cari bize borçlu (borç) kalemi tahsilatla, biz borçluyuz (alacak) kalemi ödemeyle kapanır.
      let havuz = D((tip === "borc" ? tahsilatlar : tediyeler).get(cariId) ?? 0);
      for (const k of kalemler) {
        const dusulen = Prisma.Decimal.min(havuz, k.tutarTry);
        havuz = havuz.sub(dusulen);
        const kalan = k.tutarTry.sub(dusulen);
        if (!kalan.gt(0) || !gecmis(k)) continue;
        const vade = k.vadeTarihi ?? k.tarih;
        const belge = /^Açık fatura (.+) \(\d{4}-\d{2}-\d{2}\)$/.exec(k.aciklama ?? "")?.[1] ?? null;
        const satir: AcilisKalemi = {
          faturaId: k.id, no: belge ?? "Açılış bakiyesi", cariId, cariUnvan: unvan.get(cariId) ?? "", vadeTarihi: vade.toISOString().slice(0, 10),
          gecikmeGun: Math.max(1, Math.floor((bugunBaslangic.getTime() - vade.getTime()) / 86_400_000)), kalanTry: kalan.toFixed(2), tip: tip === "borc" ? "satis" : "alis", acilis: true,
        };
        (tip === "borc" ? alacaklar : borclar).push(satir);
      }
    }
  }
  return { alacaklar, borclar };
}
