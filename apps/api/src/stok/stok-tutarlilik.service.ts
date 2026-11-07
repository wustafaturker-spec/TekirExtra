import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { ciftAnahtar, miktarFarklari, type TutarlilikTuru } from "./stok-tutarlilik";

type Tx = Prisma.TransactionClient;
/** STK-33: hizmet kartı stok tutmaz; eski hizmet hareketleri denetime girmez. */
const HIZMET_DISI: Prisma.StokHareketWhereInput = { stok: { tip: { not: "hizmet" } } };
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const toplamHaritasi = <T>(satirlar: T[], anahtar: (s: T) => string | null, miktar: (s: T) => Prisma.Decimal.Value | null) =>
  new Map(satirlar.flatMap((s) => { const a = anahtar(s); return a ? [[a, D(miktar(s))] as const] : []; }));

export interface TutarlilikSatiri {
  tur: TutarlilikTuru; stokId: string; kod: string; ad: string; depoId: string | null; depo: string | null; varyantId: string | null; varyant: string | null;
  /** STK-39: lot/seri satırında parti kimliği ve etiketi (lot · seri). */
  partiId: string | null; parti: string | null;
  kayitli: string; hareket: string; fark: string;
}

/**
 * STK-24/39: kart, depo, varyant, varyant-depo ve parti bakiyelerinin hareket
 * toplamıyla uyumu. Düzeltme Merkezi taraması da bunu kullanır (açık işlemle).
 */
export async function stokTutarlilikHesapla(tx: Tx, stokIdler?: readonly string[]) {
  // BLD-15: kart listesi verilirse yalnız o kartlar karşılaştırılır (artımlı denetim).
  if (stokIdler && !stokIdler.length) return { farklar: [] as TutarlilikSatiri[], dagitilmamis: [] as { stokId: string; kod: string; ad: string; miktar: string }[], kartSayisi: 0 };
  const kartK = stokIdler ? { id: { in: [...stokIdler] } } : {};
  const stokK = stokIdler ? { stokId: { in: [...stokIdler] } } : {};
  const [kartlar, depolar, depoBakiyeleri, varyantlar, varyantDepoBakiyeleri, partiler, hKart, hDepo, hVaryant, hVaryantDepo, hDagitilmamis, hParti] = [
    await tx.stokKart.findMany({ where: { tip: { not: "hizmet" }, ...kartK }, select: { id: true, kod: true, ad: true, mevcutMiktar: true, _count: { select: { varyantlar: true } } } }),
    await tx.depo.findMany({ select: { id: true, ad: true } }),
    await tx.stokDepoBakiye.findMany({ where: { stok: { tip: { not: "hizmet" } }, ...stokK }, select: { stokId: true, depoId: true, mevcutMiktar: true } }),
    await tx.stokVaryant.findMany({ where: stokK, select: { id: true, stokId: true, kod: true, mevcutMiktar: true } }),
    await tx.stokVaryantDepoBakiye.findMany({ where: stokIdler ? { varyant: stokK } : {}, select: { varyantId: true, depoId: true, mevcutMiktar: true } }),
    await tx.stokParti.findMany({ where: stokK, select: { id: true, stokId: true, varyantId: true, depoId: true, lotNo: true, seriNo: true, kalanMiktar: true } }),
    await tx.stokHareket.groupBy({ by: ["stokId"], where: { ...HIZMET_DISI, ...stokK }, _sum: { miktar: true } }),
    await tx.stokHareket.groupBy({ by: ["stokId", "depoId"], where: { ...HIZMET_DISI, ...stokK }, _sum: { miktar: true } }),
    await tx.stokHareket.groupBy({ by: ["varyantId"], where: { varyantId: { not: null }, ...stokK }, _sum: { miktar: true } }),
    await tx.stokHareket.groupBy({ by: ["varyantId", "depoId"], where: { varyantId: { not: null }, ...stokK }, _sum: { miktar: true } }),
    await tx.stokHareket.groupBy({ by: ["stokId"], where: { varyantId: null, ...stokK }, _sum: { miktar: true } }),
    await tx.stokHareketParti.groupBy({ by: ["partiId"], where: stokIdler ? { parti: stokK } : {}, _sum: { miktar: true } }),
  ];
  const kart = new Map(kartlar.map((k) => [k.id, k]));
  const depoAdi = new Map(depolar.map((d) => [d.id, d.ad]));
  const varyant = new Map(varyantlar.map((v) => [v.id, v]));
  const parti = new Map(partiler.map((p) => [p.id, p]));
  const satir = (tur: TutarlilikTuru, stokId: string, depoId: string | null, varyantId: string | null, f: { kayitli: Prisma.Decimal; hareket: Prisma.Decimal; fark: Prisma.Decimal }, partiId: string | null = null): TutarlilikSatiri => {
    const p = partiId ? parti.get(partiId) : undefined;
    return {
      tur, stokId, kod: kart.get(stokId)?.kod ?? "?", ad: kart.get(stokId)?.ad ?? "?", depoId, depo: depoId ? depoAdi.get(depoId) ?? "?" : null,
      varyantId, varyant: varyantId ? varyant.get(varyantId)?.kod ?? "?" : null,
      partiId, parti: p ? [p.lotNo, p.seriNo].filter(Boolean).join(" · ") : null,
      kayitli: f.kayitli.toFixed(3), hareket: f.hareket.toFixed(3), fark: f.fark.toFixed(3),
    };
  };
  const farklar: TutarlilikSatiri[] = [
    ...miktarFarklari(toplamHaritasi(kartlar, (k) => k.id, (k) => k.mevcutMiktar), toplamHaritasi(hKart, (h) => h.stokId, (h) => h._sum.miktar))
      .map((f) => satir("kart", f.anahtar, null, null, f)),
    ...miktarFarklari(toplamHaritasi(depoBakiyeleri, (b) => ciftAnahtar(b.stokId, b.depoId), (b) => b.mevcutMiktar), toplamHaritasi(hDepo, (h) => ciftAnahtar(h.stokId, h.depoId), (h) => h._sum.miktar))
      .map((f) => { const [stokId, depoId] = f.anahtar.split("|"); return satir("depo", stokId, depoId, null, f); }),
    ...miktarFarklari(toplamHaritasi(varyantlar, (v) => v.id, (v) => v.mevcutMiktar), toplamHaritasi(hVaryant, (h) => h.varyantId, (h) => h._sum.miktar))
      .map((f) => satir("varyant", varyant.get(f.anahtar)?.stokId ?? "?", null, f.anahtar, f)),
    ...miktarFarklari(toplamHaritasi(varyantDepoBakiyeleri, (b) => ciftAnahtar(b.varyantId, b.depoId), (b) => b.mevcutMiktar), toplamHaritasi(hVaryantDepo, (h) => h.varyantId && ciftAnahtar(h.varyantId, h.depoId), (h) => h._sum.miktar))
      .map((f) => { const [varyantId, depoId] = f.anahtar.split("|"); return satir("varyant_depo", varyant.get(varyantId)?.stokId ?? "?", depoId, varyantId, f); }),
    // STK-39: partinin kalan miktarı, parti hareketlerinin (işaretli) toplamına eşit olmalı.
    ...miktarFarklari(toplamHaritasi(partiler, (p) => p.id, (p) => p.kalanMiktar), toplamHaritasi(hParti, (h) => h.partiId, (h) => h._sum.miktar))
      .flatMap((f) => { const p = parti.get(f.anahtar); return p ? [satir("parti", p.stokId, p.depoId, p.varyantId, f, p.id)] : []; }),
  ];
  // Varyantlı kartta varyanta bağlanmamış hareketler: kart toplamını varyant toplamından ayırır; onarılamaz, gösterilir.
  const dagitilmamis = hDagitilmamis
    .filter((h) => (kart.get(h.stokId)?._count.varyantlar ?? 0) > 0 && !D(h._sum.miktar).isZero())
    .map((h) => ({ stokId: h.stokId, kod: kart.get(h.stokId)!.kod, ad: kart.get(h.stokId)!.ad, miktar: D(h._sum.miktar).toFixed(3) }));
  return { farklar, dagitilmamis, kartSayisi: kartlar.length };
}

/**
 * BLD-15: `sonra` anından beri stok durumu değişmiş olabilecek kartlar: yeni
 * hareket, kart ya da varyant güncellemesi (merkezi hareket yazımı kartı da
 * günceller). Bunun dışındaki doğrudan bakiye düzeltmeleri gecelik tam
 * denetimde yakalanır.
 */
export async function degisenStokKartlari(tx: Tx, sonra: Date): Promise<string[]> {
  const [hareketler, kartlar, varyantlar] = [
    await tx.stokHareket.findMany({ where: { createdAt: { gte: sonra } }, select: { stokId: true }, distinct: ["stokId"] }),
    await tx.stokKart.findMany({ where: { updatedAt: { gte: sonra } }, select: { id: true } }),
    await tx.stokVaryant.findMany({ where: { updatedAt: { gte: sonra } }, select: { stokId: true }, distinct: ["stokId"] }),
  ];
  return [...new Set([...hareketler.map((h) => h.stokId), ...kartlar.map((k) => k.id), ...varyantlar.map((v) => v.stokId)])];
}

/**
 * STK-24: bakiyelerin hareket toplamıyla uyumu. Onarım yalnız farklı satırları
 * hareket toplamına eşitler; hareket yazmaz, ortalama maliyete dokunmaz.
 */
@Injectable()
export class StokTutarlilikService {
  constructor(private readonly prisma: PrismaService) {}

  private hesapla(tx: Tx) { return stokTutarlilikHesapla(tx); }

  async denetle() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.hesapla(tx));
  }

  /** Farklı bakiyeleri hareket toplamına eşitler; kartlar kilitlenip farklar kilit altında yeniden hesaplanır. */
  async onar() {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const ilk = await this.hesapla(tx);
      const stokIdler = [...new Set(ilk.farklar.map((f) => f.stokId))];
      if (!stokIdler.length) return { duzeltilen: 0, farklar: [] as TutarlilikSatiri[] };
      await tx.$queryRaw`SELECT id FROM stok_kartlari WHERE id = ANY(${stokIdler}::uuid[]) ORDER BY id FOR UPDATE`;
      const { farklar } = await this.hesapla(tx);
      for (const f of farklar) {
        const mevcutMiktar = D(f.hareket);
        if (f.tur === "kart") await tx.stokKart.update({ where: { id: f.stokId }, data: { mevcutMiktar } });
        else if (f.tur === "depo") await tx.stokDepoBakiye.upsert({ where: { tenantId_stokId_depoId: { tenantId, stokId: f.stokId, depoId: f.depoId! } }, create: { tenantId, stokId: f.stokId, depoId: f.depoId!, mevcutMiktar }, update: { mevcutMiktar } });
        else if (f.tur === "varyant") await tx.stokVaryant.update({ where: { id: f.varyantId! }, data: { mevcutMiktar } });
        else if (f.tur === "parti") await tx.stokParti.update({ where: { id: f.partiId! }, data: { kalanMiktar: mevcutMiktar } });
        else await tx.stokVaryantDepoBakiye.upsert({ where: { tenantId_varyantId_depoId: { tenantId, varyantId: f.varyantId!, depoId: f.depoId! } }, create: { tenantId, varyantId: f.varyantId!, depoId: f.depoId!, mevcutMiktar }, update: { mevcutMiktar } });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "stok_tutarlilik_onarim", varlik: "stok", detay: { duzeltilen: farklar.length, farklar: farklar.slice(0, 200).map((f) => ({ tur: f.tur, kod: f.kod, depo: f.depo, varyant: f.varyant, parti: f.parti, kayitli: f.kayitli, hareket: f.hareket })) } as Prisma.InputJsonValue } });
      return { duzeltilen: farklar.length, farklar };
    });
  }
}
