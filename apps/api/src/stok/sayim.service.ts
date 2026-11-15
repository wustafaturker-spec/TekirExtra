import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { bugunTR } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { kurCoz } from "../doviz/kur-coz";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "./depo.service";
import { StokService } from "./stok.service";
import type { sayimOlusturSemasi } from "./stok.semalar";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const partiAnahtari = (lotNo: string, seriNo: string | null | undefined) => `${lotNo}|${seriNo ?? ""}`;

/** Sayımın parti satırı (kalemde JSON olarak saklanır). */
export interface SayimPartisi { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; sistemMiktar: string; fiiliMiktar: string }

/** Sayım tarihinin gün sonu: hareketler `tarih < sinir` ile sayılır (STK-29). */
export const sayimSiniri = (tarih: Date | string) => {
  const t = new Date(tarih);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
};

/**
 * Sayılan partiler ile sayım tarihindeki sistem partilerini birleştirir:
 * listede olmayan sistem partisi bulunamadı (fiili 0) sayılır (STK-31).
 */
export function partileriBirlestir(sayilan: { lotNo: string; seriNo?: string | null; sonKullanmaTarihi?: string | null; fiiliMiktar: Prisma.Decimal.Value }[], sistem: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; miktar: Prisma.Decimal }[]): SayimPartisi[] {
  const sonuc = new Map<string, SayimPartisi>();
  for (const p of sistem) sonuc.set(partiAnahtari(p.lotNo, p.seriNo), { lotNo: p.lotNo, seriNo: p.seriNo, sonKullanmaTarihi: p.sonKullanmaTarihi, sistemMiktar: p.miktar.toFixed(3), fiiliMiktar: "0.000" });
  for (const p of sayilan) {
    const a = partiAnahtari(p.lotNo, p.seriNo);
    const var_ = sonuc.get(a);
    sonuc.set(a, { lotNo: p.lotNo, seriNo: p.seriNo ?? null, sonKullanmaTarihi: var_?.sonKullanmaTarihi ?? p.sonKullanmaTarihi ?? null, sistemMiktar: var_?.sistemMiktar ?? "0.000", fiiliMiktar: D(p.fiiliMiktar).toFixed(3) });
  }
  return [...sonuc.values()].sort((a, b) => a.lotNo.localeCompare(b.lotNo) || (a.seriNo ?? "").localeCompare(b.seriNo ?? ""));
}

/**
 * STK-06/20/29/30/31: fiili sayım. Taslakta sistem miktarı sayım tarihinin
 * gün sonuna kadarki hareketlerden alınır; onayda aynı kuralla yeniden
 * hesaplanıp fark sayım tarihli düzeltme hareketi olarak işlenir — sayımdan
 * sonraki hareketler korunur. Varyantlı kart varyant bazında, lot/seri
 * takipli kart parti bazında sayılır.
 */
@Injectable()
export class SayimService {
  constructor(private readonly prisma: PrismaService, private readonly stokService: StokService, private readonly depoService: DepoService) {}

  private async sistemMiktari(tx: Tx, depoId: string, stokId: string, varyantId: string | null, sinir: Date) {
    const t = await tx.stokHareket.aggregate({ where: { stokId, depoId, ...(varyantId ? { varyantId } : {}), tarih: { lt: sinir } }, _sum: { miktar: true } });
    return D(t._sum.miktar);
  }

  private async partiBakiyeleri(tx: Tx, depoId: string, stokId: string, varyantId: string | null, sinir: Date) {
    const partiler = await tx.stokParti.findMany({ where: { stokId, depoId, varyantId: varyantId ?? null }, select: { id: true, lotNo: true, seriNo: true, sonKullanmaTarihi: true } });
    if (!partiler.length) return [];
    const toplamlar = await tx.stokHareketParti.groupBy({ by: ["partiId"], where: { partiId: { in: partiler.map((p) => p.id) }, hareket: { tarih: { lt: sinir } } }, _sum: { miktar: true } });
    const miktar = new Map(toplamlar.map((t) => [t.partiId, D(t._sum.miktar)]));
    return partiler
      .map((p) => ({ lotNo: p.lotNo, seriNo: p.seriNo, sonKullanmaTarihi: p.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null, miktar: miktar.get(p.id) ?? D(0) }))
      .filter((p) => !p.miktar.isZero());
  }

  /** Sayım formu: deponun sayım tarihindeki miktarları (varyant ve parti kırılımıyla). */
  async sistemListesi(depoIdHam: string | undefined, tarih: string) {
    const { tenantId } = aktifBaglam();
    const sinir = sayimSiniri(tarih);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const depoId = await this.depoService.depoCozumle(tx, depoIdHam ?? null);
      const [kartlar, toplamlar, partiler, partiToplamlari] = [
        await tx.stokKart.findMany({ where: { aktif: true, tip: { not: "hizmet" } }, orderBy: { kod: "asc" }, select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true, varyantlar: { where: { aktif: true }, orderBy: { kod: "asc" }, select: { id: true, kod: true, ad: true } } } }),
        await tx.stokHareket.groupBy({ by: ["stokId", "varyantId"], where: { depoId, tarih: { lt: sinir } }, _sum: { miktar: true } }),
        await tx.stokParti.findMany({ where: { depoId }, select: { id: true, stokId: true, varyantId: true, lotNo: true, seriNo: true, sonKullanmaTarihi: true } }),
        await tx.stokHareketParti.groupBy({ by: ["partiId"], where: { parti: { depoId }, hareket: { tarih: { lt: sinir } } }, _sum: { miktar: true } }),
      ];
      const toplam = (stokId: string, varyantId: string | null) => toplamlar.filter((t) => t.stokId === stokId && (varyantId === null || t.varyantId === varyantId)).reduce((s, t) => s.add(D(t._sum.miktar)), D(0));
      const partiMiktari = new Map(partiToplamlari.map((t) => [t.partiId, D(t._sum.miktar)]));
      const partileri = (stokId: string, varyantId: string | null) => partiler
        .filter((p) => p.stokId === stokId && (p.varyantId ?? null) === varyantId && !(partiMiktari.get(p.id) ?? D(0)).isZero())
        .map((p) => ({ lotNo: p.lotNo, seriNo: p.seriNo, sonKullanmaTarihi: p.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null, sistemMiktar: (partiMiktari.get(p.id) ?? D(0)).toFixed(3) }));
      return {
        depoId, tarih,
        satirlar: kartlar.flatMap((k) => (k.varyantlar.length ? k.varyantlar.map((v) => ({ v, varyantId: v.id as string | null })) : [{ v: null, varyantId: null as string | null }]).map(({ v, varyantId }) => ({
          stokId: k.id, varyantId, kod: v ? v.kod : k.kod, ad: k.ad, varyantAd: v?.ad ?? null, anaBirim: k.anaBirim, takipTipi: k.takipTipi,
          sistemMiktar: toplam(k.id, varyantId).toFixed(3),
          partiler: k.takipTipi === "yok" ? [] : partileri(k.id, varyantId),
        }))),
      };
    });
  }

  async olustur(girdi: z.infer<typeof sayimOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.tarih > bugunTR()) throw new BadRequestException("Sayım tarihi ileri bir tarih olamaz");
    const sinir = sayimSiniri(girdi.tarih);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Sayım tek depoyu kapsar (STK-07); depo verilmezse varsayılan depo
      const depoId = await this.depoService.depoCozumle(tx, girdi.depoId);
      const sayim = await tx.sayim.create({ data: { tenantId, depoId, tarih: new Date(girdi.tarih), aciklama: girdi.aciklama } });
      const gorulen = new Set<string>();
      for (const k of girdi.kalemler) {
        const kart = await tx.stokKart.findUnique({ where: { id: k.stokId }, select: { id: true, ad: true, tip: true, takipTipi: true, _count: { select: { varyantlar: { where: { aktif: true } } } } } });
        if (!kart) throw new NotFoundException(`Sayılmak istenen '${k.stokId}' ürünü bulunamadı`);
        if (kart.tip === "hizmet") throw new BadRequestException(`'${kart.ad}' bir hizmet kartı; sayılamaz`);
        const varyantId = k.varyantId ?? null;
        if (kart._count.varyantlar > 0 && !varyantId) throw new BadRequestException(`'${kart.ad}' varyantlı; her varyant ayrı sayılmalıdır`);
        if (varyantId) await this.stokService.varyantDogrula(tx, kart.id, varyantId);
        const anahtar = `${kart.id}|${varyantId ?? ""}`;
        if (gorulen.has(anahtar)) throw new BadRequestException(`'${kart.ad}' sayımda birden çok kez var`);
        gorulen.add(anahtar);
        let partiler: SayimPartisi[] | null = null;
        if (kart.takipTipi !== "yok") {
          const sayilan = k.partiler ?? [];
          if (kart.takipTipi === "seri" && sayilan.some((p) => !p.seriNo || !["0", "1"].includes(String(Number(p.fiiliMiktar))))) throw new BadRequestException(`'${kart.ad}' seri takipli; her seri numarası 0 ya da 1 adet sayılır`);
          if (!D(k.fiiliMiktar).eq(sayilan.reduce((t, p) => t.add(D(p.fiiliMiktar)), D(0)))) throw new BadRequestException(`'${kart.ad}' lot/seri takipli; fiili miktar parti miktarlarının toplamı olmalıdır`);
          partiler = partileriBirlestir(sayilan, await this.partiBakiyeleri(tx, depoId, kart.id, varyantId, sinir));
        } else if (k.partiler?.length) throw new BadRequestException(`'${kart.ad}' kartında seri/lot takibi açık değil`);
        await tx.sayimKalem.create({ data: {
          tenantId, sayimId: sayim.id, stokId: kart.id, varyantId,
          sistemMiktar: await this.sistemMiktari(tx, depoId, kart.id, varyantId, sinir), fiiliMiktar: D(k.fiiliMiktar),
          ...(partiler && { partiler: partiler as unknown as Prisma.InputJsonValue }),
        } });
      }
      return sayim;
    });
  }

  /**
   * Onay (STK-20/29): sistem miktarı sayım tarihine göre yeniden hesaplanır,
   * fark sayım tarihli `sayim_duzeltme` olarak işlenir. Lotlu üründe fazlalar
   * tek giriş, eksikler belirtilen partilerden tek çıkış hareketidir.
   */
  async onayla(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (!["muhasebe", "yonetici"].includes(rol)) throw new ForbiddenException("Sayım onayı için muhasebe veya yönetici rolü gerekir");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sayim = await tx.sayim.findUnique({ where: { id }, include: { kalemler: true } });
      if (!sayim) throw new NotFoundException("Sayım bulunamadı");
      if (sayim.durum !== "taslak") throw new BadRequestException("Sayım zaten onaylanmış");
      await this.stokService.kartlariKilitle(tx, sayim.kalemler.map((k) => k.stokId));
      const sinir = sayimSiniri(sayim.tarih);
      const ortak = { depoId: sayim.depoId, tip: "sayim_duzeltme" as const, tarih: new Date(sayim.tarih), aciklama: `${sayim.id} nolu sayım düzeltmesi`, kaynakTur: "sayim", kaynakRef: sayim.id };

      for (const k of sayim.kalemler) {
        const urun = await tx.stokKart.findUnique({ where: { id: k.stokId } });
        if (!urun) continue;
        const sistem = await this.sistemMiktari(tx, sayim.depoId, k.stokId, k.varyantId, sinir);
        const fark = D(k.fiiliMiktar).sub(sistem);
        // Stok varsa sayım farkı ortalama maliyetle, yoksa kartın alış fiyatıyla (STK-28 yeniden hesaplama da böyle okur).
        const birimMaliyet = sistem.gt(0) ? D(urun.ortalamaMaliyet) : await kartAlisMaliyeti(tx, tenantId, urun, new Date(sayim.tarih));
        const hareket = (miktar: Prisma.Decimal, partiler?: { lotNo: string; seriNo: string | null; sonKullanmaTarihi: string | null; miktar: Prisma.Decimal }[], partiSecimi?: "belirtilen") =>
          this.stokService.hareketEkle(tx, { ...ortak, stokId: k.stokId, varyantId: k.varyantId, miktar, girilenBirim: urun.anaBirim, girilenMiktar: miktar, birimMaliyet, partiler, partiSecimi });

        if (urun.takipTipi === "yok") {
          if (!fark.isZero()) await hareket(fark);
          await tx.sayimKalem.update({ where: { id: k.id }, data: { sistemMiktar: sistem } });
          continue;
        }
        const partiler = partileriBirlestir(((k.partiler as unknown as SayimPartisi[] | null) ?? []).map((p) => ({ ...p, fiiliMiktar: p.fiiliMiktar })), await this.partiBakiyeleri(tx, sayim.depoId, k.stokId, k.varyantId, sinir));
        const farklar = partiler.map((p) => ({ p, fark: D(p.fiiliMiktar).sub(D(p.sistemMiktar)) }));
        const fazla = farklar.filter((f) => f.fark.gt(0)), eksik = farklar.filter((f) => f.fark.lt(0));
        const parti = (f: (typeof farklar)[number]) => ({ lotNo: f.p.lotNo, seriNo: f.p.seriNo, sonKullanmaTarihi: f.p.sonKullanmaTarihi, miktar: f.fark.abs() });
        if (fazla.length) await hareket(fazla.reduce((t, f) => t.add(f.fark), D(0)), fazla.map(parti));
        if (eksik.length) await hareket(eksik.reduce((t, f) => t.add(f.fark), D(0)), eksik.map(parti), "belirtilen");
        await tx.sayimKalem.update({ where: { id: k.id }, data: { sistemMiktar: sistem, partiler: partiler as unknown as Prisma.InputJsonValue } });
      }
      return tx.sayim.update({ where: { id }, data: { durum: "onaylandi", onaylayanUserId: userId, onayZamani: new Date() } });
    });
  }

  async liste() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.sayim.findMany({ orderBy: { tarih: "desc" }, include: { depo: { select: { id: true, kod: true, ad: true } }, _count: { select: { kalemler: true } } } }));
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sayim = await tx.sayim.findUnique({ where: { id }, include: { depo: { select: { id: true, kod: true, ad: true } }, kalemler: { include: { varyant: { select: { id: true, kod: true, ad: true } } } } } });
      if (!sayim) throw new NotFoundException("Sayım bulunamadı");
      const stoklar = new Map((await tx.stokKart.findMany({ where: { id: { in: sayim.kalemler.map((k) => k.stokId) } }, select: { id: true, kod: true, ad: true, anaBirim: true } })).map((s) => [s.id, s]));
      return { ...sayim, kalemler: sayim.kalemler.map((k) => ({ ...k, stok: stoklar.get(k.stokId) ?? null })) };
    });
  }
}

/**
 * Stok yokken sayım farkının birim maliyeti: kartın alış fiyatı, TL karşılığı.
 * Dövizli alış fiyatı sayım günü kuruyla çevrilir (alış belgelerindeki gibi
 * döviz satış kuru). 2026-11-15'e kadar döviz çevrilmiyordu: 0,25 USD alış
 * fiyatlı üründe sayım girişleri 0,25 TL maliyetle yazılıp ortalamayı bozdu.
 * Kur bulunamazsa onay durur; yanlış maliyetle yazmak yerine kur istenir.
 */
export async function kartAlisMaliyeti(
  tx: Prisma.TransactionClient,
  tenantId: string,
  urun: { ad: string; alisFiyati: Prisma.Decimal | null; alisFiyatiDoviz: string },
  tarih: Date,
): Promise<Prisma.Decimal> {
  if (urun.alisFiyati === null || !D(urun.alisFiyati).gt(0)) return D(0);
  if (urun.alisFiyatiDoviz === "TRY") return D(urun.alisFiyati);
  const kur = await kurCoz(tx, tenantId, urun.alisFiyatiDoviz, tarih, "satis");
  if (!kur) {
    throw new BadRequestException(
      `'${urun.ad}' ürününün alış fiyatı ${urun.alisFiyatiDoviz} cinsinden ve stoğu sayım tarihinde sıfır ya da eksi; ` +
      `sayım farkını değerlemek için ${tarih.toISOString().slice(0, 10)} tarihli ${urun.alisFiyatiDoviz} kuru gerekiyor. Ayarlar › Döviz Kurları'ndan kuru çekin ya da girin.`,
    );
  }
  return D(urun.alisFiyati).mul(kur).toDecimalPlaces(4);
}
