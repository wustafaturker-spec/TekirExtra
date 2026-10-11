/**
 * RPR-15 (inceleme P1-5): panel özetinin varlık kalemleri veritabanında
 * toplanır. Eskiden aktif cariler bütün hareketleriyle belleğe alınıyordu
 * (2026-09-29 bellek çöküşü kalıbı), pasif carilerin açık bakiyesi düşüyordu
 * ve eksi stok değerlemeyi eksiye çekiyordu (demo −51,9 M TL).
 */
import { Prisma } from "@prisma/client";
import { guncelKurlar, guncelTlDegeri, type GuncelKurlar } from "../cari/doviz-degerleme";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface EnvanterDegerlemesi {
  /** Yalnız artı stoklu ürün ve sarf kartlarının miktar × ortalama maliyeti. */
  deger: Prisma.Decimal;
  /** Değerlemeye girmeyen eksi stoklu kart sayısı. */
  eksiStokSayisi: number;
}

/** Ürün/sarf kartlarının stok değeri; eksi stok değerlenmez, sayılır. Pasif kart da stok taşıyorsa varlıktır. */
export async function envanterDegerlemesi(tx: Tx, tenantId: string): Promise<EnvanterDegerlemesi> {
  const [r] = await tx.$queryRaw<{ deger: string; eksi: number }[]>`
    SELECT coalesce(sum(mevcut_miktar * ortalama_maliyet) FILTER (WHERE mevcut_miktar > 0), 0)::text AS deger,
           count(*) FILTER (WHERE mevcut_miktar < 0)::int AS eksi
    FROM stok_kartlari
    WHERE tenant_id = ${tenantId}::uuid AND tip::text IN ('urun', 'sarf')`;
  return { deger: D(r?.deger ?? 0).toDecimalPlaces(2), eksiStokSayisi: r?.eksi ?? 0 };
}

export interface CariHareketGrubu {
  cariId: string;
  dovizCinsi: string;
  tip: string;
  _sum: { tutar: Prisma.Decimal | null; tutarTry: Prisma.Decimal | null };
}

export interface CariBakiyeOzeti {
  /** Borçlu (bize borcu olan) carilerin bakiyeleri toplamı. */
  alacaklar: Prisma.Decimal;
  /** Alacaklı (bizim borçlu olduğumuz) carilerin bakiyeleri toplamı, artı işaretli. */
  borclar: Prisma.Decimal;
  /** Güncel kuru bulunamayıp tarihî TL ile değerlenen dövizler. */
  kurEksik: string[];
}

/**
 * Cari başına bakiye (cari kartıyla aynı kural, CARI-33): dövizli bakiye
 * güncel satış kuruyla TL'ye çevrilir, cari içinde dövizler netleşir;
 * net bakiye artıysa alacak, eksiyse borç tarafına yazılır.
 */
export function cariBakiyeOzeti(gruplar: CariHareketGrubu[], kurlar: GuncelKurlar): CariBakiyeOzeti {
  const cariDoviz = new Map<string, { tutar: Prisma.Decimal; tutarTry: Prisma.Decimal }>();
  for (const g of gruplar) {
    const a = `${g.cariId}|${g.dovizCinsi}`;
    const k = cariDoviz.get(a) ?? { tutar: D(0), tutarTry: D(0) };
    const isaret = g.tip === "borc" ? 1 : -1;
    k.tutar = k.tutar.add(D(g._sum.tutar ?? 0).mul(isaret));
    k.tutarTry = k.tutarTry.add(D(g._sum.tutarTry ?? 0).mul(isaret));
    cariDoviz.set(a, k);
  }
  const cariNet = new Map<string, Prisma.Decimal>();
  const kurEksik = new Set<string>();
  for (const [a, k] of cariDoviz) {
    const [cariId, doviz] = a.split("|");
    const d = guncelTlDegeri(doviz, k.tutar, k.tutarTry, kurlar);
    if (d.kurEksik && !k.tutar.isZero()) kurEksik.add(doviz);
    cariNet.set(cariId, (cariNet.get(cariId) ?? D(0)).add(d.guncelTry));
  }
  let alacaklar = D(0), borclar = D(0);
  for (const net of cariNet.values()) {
    if (net.gt(0)) alacaklar = alacaklar.add(net);
    else if (net.lt(0)) borclar = borclar.add(net.abs());
  }
  return { alacaklar, borclar, kurEksik: [...kurEksik].sort() };
}

/** Bütün carilerin (pasifler dahil) bakiye toplamları; gruplama veritabanında. */
export async function cariBakiyeToplamlari(tx: Tx, tenantId: string): Promise<CariBakiyeOzeti> {
  const gruplar = await tx.cariHareket.groupBy({
    by: ["cariId", "dovizCinsi", "tip"],
    where: { tenantId },
    _sum: { tutar: true, tutarTry: true },
  });
  const kurlar = await guncelKurlar(tx, tenantId, gruplar.map((g) => g.dovizCinsi));
  return cariBakiyeOzeti(gruplar, kurlar);
}
