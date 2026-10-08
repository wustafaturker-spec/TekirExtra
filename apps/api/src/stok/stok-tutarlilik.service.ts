import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { ciftAnahtar, miktarFarklari, type TutarlilikTuru } from "./stok-tutarlilik";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const toplamHaritasi = <T>(satirlar: T[], anahtar: (s: T) => string | null, miktar: (s: T) => Prisma.Decimal.Value | null) =>
  new Map(satirlar.flatMap((s) => { const a = anahtar(s); return a ? [[a, D(miktar(s))] as const] : []; }));

export interface TutarlilikSatiri {
  tur: TutarlilikTuru; stokId: string; kod: string; ad: string; depoId: string | null; depo: string | null; varyantId: string | null; varyant: string | null;
  kayitli: string; hareket: string; fark: string;
}

/**
 * STK-24: kart, depo, varyant ve varyant-depo bakiyelerinin hareket
 * toplamıyla uyumu. Onarım yalnız farklı satırları hareket toplamına eşitler;
 * hareket yazmaz, ortalama maliyete dokunmaz.
 */
@Injectable()
export class StokTutarlilikService {
  constructor(private readonly prisma: PrismaService) {}

  private async hesapla(tx: Tx) {
    const [kartlar, depolar, depoBakiyeleri, varyantlar, varyantDepoBakiyeleri, hKart, hDepo, hVaryant, hVaryantDepo, hDagitilmamis] = [
      await tx.stokKart.findMany({ select: { id: true, kod: true, ad: true, mevcutMiktar: true, _count: { select: { varyantlar: true } } } }),
      await tx.depo.findMany({ select: { id: true, ad: true } }),
      await tx.stokDepoBakiye.findMany({ select: { stokId: true, depoId: true, mevcutMiktar: true } }),
      await tx.stokVaryant.findMany({ select: { id: true, stokId: true, kod: true, mevcutMiktar: true } }),
      await tx.stokVaryantDepoBakiye.findMany({ select: { varyantId: true, depoId: true, mevcutMiktar: true } }),
      await tx.stokHareket.groupBy({ by: ["stokId"], _sum: { miktar: true } }),
      await tx.stokHareket.groupBy({ by: ["stokId", "depoId"], _sum: { miktar: true } }),
      await tx.stokHareket.groupBy({ by: ["varyantId"], where: { varyantId: { not: null } }, _sum: { miktar: true } }),
      await tx.stokHareket.groupBy({ by: ["varyantId", "depoId"], where: { varyantId: { not: null } }, _sum: { miktar: true } }),
      await tx.stokHareket.groupBy({ by: ["stokId"], where: { varyantId: null }, _sum: { miktar: true } }),
    ];
    const kart = new Map(kartlar.map((k) => [k.id, k]));
    const depoAdi = new Map(depolar.map((d) => [d.id, d.ad]));
    const varyant = new Map(varyantlar.map((v) => [v.id, v]));
    const satir = (tur: TutarlilikTuru, stokId: string, depoId: string | null, varyantId: string | null, f: { kayitli: Prisma.Decimal; hareket: Prisma.Decimal; fark: Prisma.Decimal }): TutarlilikSatiri => ({
      tur, stokId, kod: kart.get(stokId)?.kod ?? "?", ad: kart.get(stokId)?.ad ?? "?", depoId, depo: depoId ? depoAdi.get(depoId) ?? "?" : null,
      varyantId, varyant: varyantId ? varyant.get(varyantId)?.kod ?? "?" : null, kayitli: f.kayitli.toFixed(3), hareket: f.hareket.toFixed(3), fark: f.fark.toFixed(3),
    });
    const farklar: TutarlilikSatiri[] = [
      ...miktarFarklari(toplamHaritasi(kartlar, (k) => k.id, (k) => k.mevcutMiktar), toplamHaritasi(hKart, (h) => h.stokId, (h) => h._sum.miktar))
        .map((f) => satir("kart", f.anahtar, null, null, f)),
      ...miktarFarklari(toplamHaritasi(depoBakiyeleri, (b) => ciftAnahtar(b.stokId, b.depoId), (b) => b.mevcutMiktar), toplamHaritasi(hDepo, (h) => ciftAnahtar(h.stokId, h.depoId), (h) => h._sum.miktar))
        .map((f) => { const [stokId, depoId] = f.anahtar.split("|"); return satir("depo", stokId, depoId, null, f); }),
      ...miktarFarklari(toplamHaritasi(varyantlar, (v) => v.id, (v) => v.mevcutMiktar), toplamHaritasi(hVaryant, (h) => h.varyantId, (h) => h._sum.miktar))
        .map((f) => satir("varyant", varyant.get(f.anahtar)?.stokId ?? "?", null, f.anahtar, f)),
      ...miktarFarklari(toplamHaritasi(varyantDepoBakiyeleri, (b) => ciftAnahtar(b.varyantId, b.depoId), (b) => b.mevcutMiktar), toplamHaritasi(hVaryantDepo, (h) => h.varyantId && ciftAnahtar(h.varyantId, h.depoId), (h) => h._sum.miktar))
        .map((f) => { const [varyantId, depoId] = f.anahtar.split("|"); return satir("varyant_depo", varyant.get(varyantId)?.stokId ?? "?", depoId, varyantId, f); }),
    ];
    // Varyantlı kartta varyanta bağlanmamış hareketler: kart toplamını varyant toplamından ayırır; onarılamaz, gösterilir.
    const dagitilmamis = hDagitilmamis
      .filter((h) => (kart.get(h.stokId)?._count.varyantlar ?? 0) > 0 && !D(h._sum.miktar).isZero())
      .map((h) => ({ stokId: h.stokId, kod: kart.get(h.stokId)!.kod, ad: kart.get(h.stokId)!.ad, miktar: D(h._sum.miktar).toFixed(3) }));
    return { farklar, dagitilmamis, kartSayisi: kartlar.length };
  }

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
        else await tx.stokVaryantDepoBakiye.upsert({ where: { tenantId_varyantId_depoId: { tenantId, varyantId: f.varyantId!, depoId: f.depoId! } }, create: { tenantId, varyantId: f.varyantId!, depoId: f.depoId!, mevcutMiktar }, update: { mevcutMiktar } });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "stok_tutarlilik_onarim", varlik: "stok", detay: { duzeltilen: farklar.length, farklar: farklar.slice(0, 200).map((f) => ({ tur: f.tur, kod: f.kod, depo: f.depo, varyant: f.varyant, kayitli: f.kayitli, hareket: f.hareket })) } as Prisma.InputJsonValue } });
      return { duzeltilen: farklar.length, farklar };
    });
  }
}
