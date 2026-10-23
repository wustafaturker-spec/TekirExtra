import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { araDonemTutari, eksikOncekiYillar } from "./amortisman-hesap";
import { binekSiniri, kartBedeli, kartPlani, type KartKaydi } from "./demirbas.service";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SIFIR = D(0);

const KART_INCLUDE = { ilaveBedeller: true, amortismanlar: { include: { donem: { select: { durum: true } } } } } satisfies Prisma.DemirbasInclude;

export interface OnizlemeSatiri {
  demirbasId: string; kod: string; ad: string; sinif: string; bedel: Prisma.Decimal;
  tutar: Prisma.Decimal; kkeg: Prisma.Decimal; birikmisOnce: Prisma.Decimal; birikmisSonra: Prisma.Decimal; netDeger: Prisma.Decimal;
}

/** DMR-07: yıl sonu amortisman çalıştırması (önizleme, kesinleştirme, geri alma) ve ara dönem raporu. */
@Injectable()
export class AmortismanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly donemKilidi: DonemKilidiService,
  ) {}

  /**
   * Yılın hesabı: edinme yılı ≤ yıl, o yıl elden çıkmamış kartlar. Önceki yılı
   * kesinleşmemiş kart `eksikler`e düşer; kesinleştirme bunlar varken yapılmaz.
   */
  private async hesapla(tx: Tx, yil: number) {
    const kartlar: KartKaydi[] = await tx.demirbas.findMany({
      where: {
        edinmeTarihi: { lte: new Date(Date.UTC(yil, 11, 31)) },
        OR: [{ cikisTarihi: null }, { cikisTarihi: { gte: new Date(Date.UTC(yil + 1, 0, 1)) } }],
      },
      include: KART_INCLUDE,
      orderBy: { kod: "asc" },
    });
    const satirlar: OnizlemeSatiri[] = [];
    const eksikler: { kod: string; ad: string; yillar: number[] }[] = [];
    for (const k of kartlar) {
      const plan = kartPlani(k, await binekSiniri(tx, k));
      const eksik = eksikOncekiYillar(plan, yil);
      if (eksik.length) eksikler.push({ kod: k.kod, ad: k.ad, yillar: eksik });
      const p = plan.satirlar.find((s) => s.yil === yil);
      if (!p || p.tutar.isZero()) continue;
      const bedel = kartBedeli(k);
      satirlar.push({ demirbasId: k.id, kod: k.kod, ad: k.ad, sinif: k.sinif, bedel, tutar: p.tutar, kkeg: p.kkeg, birikmisOnce: p.birikmisOnce, birikmisSonra: p.birikmisSonra, netDeger: bedel.sub(p.birikmisSonra) });
    }
    const toplam = satirlar.reduce((t, s) => t.add(s.tutar), SIFIR);
    const toplamKkeg = satirlar.reduce((t, s) => t.add(s.kkeg), SIFIR);
    return { satirlar, eksikler, toplam, toplamKkeg };
  }

  async donemler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.amortismanDonemi.findMany({ orderBy: [{ yil: "desc" }, { kesinlesmeAt: "desc" }], include: { _count: { select: { satirlar: true } } } }),
    );
  }

  async onizleme(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kesin = await tx.amortismanDonemi.findFirst({ where: { yil, durum: "kesin" }, include: { satirlar: true } });
      const sonraki = await tx.amortismanDonemi.findFirst({ where: { yil: { gt: yil }, durum: "kesin" }, select: { yil: true } });
      const h = await this.hesapla(tx, yil);
      return { yil, kesin: kesin ? { id: kesin.id, kesinlesmeAt: kesin.kesinlesmeAt, toplam: kesin.toplam, toplamKkeg: kesin.toplamKkeg } : null, sonrakiKesinYil: sonraki?.yil ?? null, ...h };
    });
  }

  async kesinlestir(yil: number) {
    const { tenantId, userId } = aktifBaglam();
    if (yil > Number(bugunTR().slice(0, 4))) throw new BadRequestException("Gelecek yılın amortismanı kesinleştirilemez");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.donemKilidi.tarihDogrula(tenantId, new Date(Date.UTC(yil, 11, 31, 12)), "amortisman kesinleştirme", tx);
      if (await tx.amortismanDonemi.findFirst({ where: { yil, durum: "kesin" } })) throw new ConflictException(`${yil} amortismanı zaten kesinleşmiş`);
      const sonraki = await tx.amortismanDonemi.findFirst({ where: { yil: { gt: yil }, durum: "kesin" }, select: { yil: true } });
      if (sonraki) throw new ConflictException(`${sonraki.yil} kesinleşmiş; önceki bir yıl sonradan kesinleştirilemez`);
      const h = await this.hesapla(tx, yil);
      if (h.eksikler.length) {
        throw new ConflictException(`Önceki yılları kesinleşmemiş kartlar var: ${h.eksikler.slice(0, 5).map((e) => `${e.kod} (${e.yillar.join(", ")})`).join("; ")}${h.eksikler.length > 5 ? "…" : ""}`);
      }
      if (!h.satirlar.length) throw new BadRequestException(`${yil} için ayrılacak amortisman yok`);
      try {
        const donem = await tx.amortismanDonemi.create({
          data: {
            tenantId, yil, toplam: h.toplam, toplamKkeg: h.toplamKkeg, kesinlestirenUserId: userId,
            satirlar: { create: h.satirlar.map((s) => ({ tenantId, demirbasId: s.demirbasId, yil, tutar: s.tutar, kkeg: s.kkeg, birikmisOnce: s.birikmisOnce })) },
          },
        });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "amortisman_kesinlesti", varlik: "amortisman_donemi", varlikId: donem.id, detay: { yil, kart: h.satirlar.length, toplam: h.toplam.toFixed(2), kkeg: h.toplamKkeg.toFixed(2) } } });
        return { id: donem.id, yil, kart: h.satirlar.length, toplam: h.toplam, toplamKkeg: h.toplamKkeg };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException(`${yil} amortismanı zaten kesinleşmiş`);
        throw e;
      }
    });
  }

  async geriAl(yil: number, gerekce: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.amortismanDonemi.findFirst({ where: { yil, durum: "kesin" }, include: { satirlar: { select: { demirbasId: true } } } });
      if (!d) throw new NotFoundException(`${yil} için kesin amortisman yok`);
      await this.donemKilidi.tarihDogrula(tenantId, new Date(Date.UTC(yil, 11, 31, 12)), "amortisman geri alma", tx);
      const sonraki = await tx.amortismanDonemi.findFirst({ where: { yil: { gt: yil }, durum: "kesin" }, select: { yil: true } });
      if (sonraki) throw new ConflictException(`${sonraki.yil} kesinleşmiş; önce o yılı geri alın`);
      const cikan = await tx.demirbas.findFirst({ where: { id: { in: d.satirlar.map((s) => s.demirbasId) }, durum: "elden_cikti" }, select: { kod: true } });
      if (cikan) throw new ConflictException(`${cikan.kod} elden çıkmış; çıkıştaki birikmiş amortisman bu yılı içeriyor. Önce çıkışı geri alın.`);
      await tx.amortismanDonemi.update({ where: { id: d.id }, data: { durum: "geri_alindi", geriAlanUserId: userId, geriAlmaAt: new Date(), geriAlmaGerekcesi: gerekce } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "amortisman_geri_alindi", varlik: "amortisman_donemi", varlikId: d.id, detay: { yil, gerekce } } });
      return { geriAlindi: true };
    });
  }

  /** DMR-07: geçici vergi dönemleri için bilgi raporu; kayıt oluşmaz. */
  async araDonem(yil: number, ceyrek: 1 | 2 | 3 | 4) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const h = await this.hesapla(tx, yil);
      const satirlar = h.satirlar.map((s) => ({ ...s, yillik: s.tutar, donem: araDonemTutari(s.tutar, ceyrek), donemKkeg: araDonemTutari(s.kkeg, ceyrek) }));
      return { yil, ceyrek, satirlar, toplam: satirlar.reduce((t, s) => t.add(s.donem), SIFIR), toplamKkeg: satirlar.reduce((t, s) => t.add(s.donemKkeg), SIFIR) };
    });
  }

  /** DMR-12: yılın amortisman dökümü (kesin yılda kayıttan, değilse plandan). */
  async yilDokumu(yil: number) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kesin = await tx.amortismanDonemi.findFirst({ where: { yil, durum: "kesin" }, include: { satirlar: { include: { demirbas: { include: KART_INCLUDE } } } } });
      if (!kesin) return { yil, kesin: false, ...(await this.hesapla(tx, yil)) };
      const satirlar: OnizlemeSatiri[] = kesin.satirlar.map((s) => {
        const bedel = kartBedeli(s.demirbas);
        const sonra = D(s.birikmisOnce).add(s.tutar);
        return { demirbasId: s.demirbasId, kod: s.demirbas.kod, ad: s.demirbas.ad, sinif: s.demirbas.sinif, bedel, tutar: D(s.tutar), kkeg: D(s.kkeg), birikmisOnce: D(s.birikmisOnce), birikmisSonra: sonra, netDeger: bedel.sub(sonra) };
      }).sort((a, b) => a.kod.localeCompare(b.kod));
      return { yil, kesin: true, satirlar, eksikler: [], toplam: D(kesin.toplam), toplamKkeg: D(kesin.toplamKkeg) };
    });
  }
}

