import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { birimKatsayisiBul } from "./birim-cevrim";
import { paylariHesapla, type DagitimYontemi } from "./maliyet-dagitimi";
import { StokMaliyetService } from "./stok-maliyet.service";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const tarihTR = (d: Date) => d.toLocaleDateString("tr-TR");

export interface DagitimGirdisi {
  kaynakTur: "masraf" | "fatura_satiri";
  kaynakId: string;
  hedefFaturaIdler: string[];
  yontem: DagitimYontemi;
  aciklama?: string | null;
}

/** Aktif dağıtımın kaynağı ya da hedefi olan faturanın kimliğe göre koşulu (iptal engeli). */
export const faturaDagitimKosulu = (faturaId: string): Prisma.MaliyetDagitimiWhereInput => ({
  durum: "aktif",
  OR: [{ paylar: { some: { faturaId } } }, { faturaSatir: { faturaId } }],
});

/**
 * STK-40: nakliye, gümrük, sigorta gibi giderin alış faturalarının stok
 * satırlarına dağıtılması. Pay alış maliyetine eklenir; etkilenen kartların
 * maliyeti aynı işlemde yeniden hesaplanır (STK-28 çekirdeği). Kapalı
 * dönemdeki kaynak ya da hedefe dağıtım yapılmaz; geri alma da aynı kuralla.
 */
@Injectable()
export class MaliyetDagitimiService {
  constructor(private readonly prisma: PrismaService, private readonly maliyet: StokMaliyetService) {}

  private async kaynakOku(tx: Tx, girdi: Pick<DagitimGirdisi, "kaynakTur" | "kaynakId">) {
    if (girdi.kaynakTur === "masraf") {
      const m = await tx.masraf.findUnique({ where: { id: girdi.kaynakId }, include: { kategori: { select: { ad: true } } } });
      if (!m) throw new NotFoundException("Masraf bulunamadı");
      if (m.durum !== "onaylandi") throw new BadRequestException("Yalnız onaylı masraf dağıtılabilir");
      return { masrafId: m.id, faturaSatirId: null, tarih: m.tarih, tutar: m.matrah.mul(m.kur).toDecimalPlaces(2), etiket: `Masraf ${m.belgeNo ?? m.saticiUnvan ?? m.kategori.ad}` };
    }
    const s = await tx.faturaSatir.findUnique({ where: { id: girdi.kaynakId }, include: { fatura: { select: { no: true, tip: true, durum: true, kur: true, tarih: true } }, stok: { select: { tip: true, ad: true } } } });
    if (!s) throw new NotFoundException("Fatura satırı bulunamadı");
    if (s.fatura.tip !== "alis" || s.fatura.durum !== "kesin") throw new BadRequestException("Kaynak satır kesinleşmiş bir alış faturasında olmalı");
    if (s.stok.tip !== "hizmet") throw new BadRequestException("Yalnız hizmet satırı (nakliye, gümrük, sigorta…) dağıtılabilir");
    return { masrafId: null, faturaSatirId: s.id, tarih: s.fatura.tarih, tutar: s.matrah.mul(s.fatura.kur).toDecimalPlaces(2), etiket: `${s.fatura.no ?? "Alış faturası"} · ${s.stok.ad}` };
  }

  /** Doğrular ve payları hesaplar; yazmaz. */
  private async hazirla(tx: Tx, girdi: DagitimGirdisi) {
    const kaynak = await this.kaynakOku(tx, girdi);
    if (!kaynak.tutar.gt(0)) throw new BadRequestException("Kaynağın tutarı sıfır");
    const mevcut = await tx.maliyetDagitimi.findFirst({ where: { durum: "aktif", ...(kaynak.masrafId ? { masrafId: kaynak.masrafId } : { faturaSatirId: kaynak.faturaSatirId }) }, select: { id: true } });
    if (mevcut) throw new ConflictException("Bu gider zaten dağıtılmış; yeniden dağıtmak için önce mevcut dağıtımı geri alın");

    const idler = [...new Set(girdi.hedefFaturaIdler)];
    if (!idler.length) throw new BadRequestException("En az bir alış faturası seçin");
    const faturalar = await tx.fatura.findMany({
      where: { id: { in: idler } },
      select: { id: true, no: true, tip: true, durum: true, kur: true, tarih: true, satirlar: { where: { stok: { tip: { not: "hizmet" } } }, select: { id: true, stokId: true, varyantId: true, miktar: true, birim: true, matrah: true, stok: { select: { kod: true, ad: true, anaBirim: true } } } } },
    });
    if (faturalar.length !== idler.length) throw new NotFoundException("Seçilen faturalardan biri bulunamadı");
    const uygunsuz = faturalar.find((f) => f.tip !== "alis" || f.durum !== "kesin");
    if (uygunsuz) throw new BadRequestException(`${uygunsuz.no ?? "Seçilen fatura"} kesinleşmiş bir alış faturası değil`);

    const acik = await this.maliyet.acikDonemBaslangici(tx);
    if (acik) {
      if (kaynak.tarih < acik) throw new ConflictException(`Giderin tarihi (${tarihTR(kaynak.tarih)}) kapalı dönemde; dağıtılamaz`);
      const kapali = faturalar.find((f) => f.tarih < acik);
      if (kapali) throw new ConflictException(`${kapali.no ?? "Seçilen fatura"} kapalı dönemde (${tarihTR(kapali.tarih)}); maliyeti değiştirilemez`);
    }

    const satirlar = [];
    for (const f of faturalar) {
      for (const s of f.satirlar) {
        satirlar.push({
          faturaSatirId: s.id, faturaId: f.id, faturaNo: f.no, stokId: s.stokId, varyantId: s.varyantId,
          kod: s.stok.kod, ad: s.stok.ad, anaBirim: s.stok.anaBirim,
          matrahTl: s.matrah.mul(f.kur).toDecimalPlaces(2),
          anaMiktar: s.miktar.mul(await birimKatsayisiBul(tx, s.stokId, s.birim).catch(() => D(1))),
        });
      }
    }
    if (!satirlar.length) throw new BadRequestException("Seçilen faturalarda stoklu ürün satırı yok");
    let paylar;
    try { paylar = paylariHesapla(kaynak.tutar, girdi.yontem, satirlar); }
    catch (hata) { throw new BadRequestException(hata instanceof Error ? hata.message : String(hata)); }
    return { kaynak, paylar };
  }

  async onizle(girdi: DagitimGirdisi) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { kaynak, paylar } = await this.hazirla(tx, girdi);
      return {
        kaynak: { etiket: kaynak.etiket, tarih: kaynak.tarih, tutar: kaynak.tutar.toFixed(2) },
        satirlar: paylar.map((p) => ({
          faturaNo: p.faturaNo, kod: p.kod, ad: p.ad, anaBirim: p.anaBirim, anaMiktar: p.anaMiktar.toFixed(3), matrahTl: p.matrahTl.toFixed(2),
          pay: p.pay.toFixed(2), birimArtis: p.anaMiktar.gt(0) ? p.pay.div(p.anaMiktar).toFixed(4) : "0",
        })),
      };
    });
  }

  async olustur(girdi: DagitimGirdisi) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { kaynak, paylar } = await this.hazirla(tx, girdi);
      const dagitim = await tx.maliyetDagitimi.create({
        data: {
          tenantId, kaynakTur: girdi.kaynakTur, masrafId: kaynak.masrafId, faturaSatirId: kaynak.faturaSatirId,
          tarih: kaynak.tarih, tutar: kaynak.tutar, yontem: girdi.yontem, aciklama: girdi.aciklama?.trim() || null, userId,
          paylar: { create: paylar.map((p) => ({ tenantId, faturaId: p.faturaId, faturaSatirId: p.faturaSatirId, stokId: p.stokId, varyantId: p.varyantId, tutar: p.pay })) },
        },
      });
      const kartlar = await this.kartlariYenile(tx, paylar.map((p) => p.stokId));
      await tx.auditLog.create({ data: { tenantId, userId, islem: "maliyet_dagitimi", varlik: "maliyet_dagitimi", varlikId: dagitim.id, detay: { kaynak: kaynak.etiket, tutar: kaynak.tutar.toFixed(2), yontem: girdi.yontem, satir: paylar.length, kartlar } as Prisma.InputJsonValue } });
      return { id: dagitim.id, kartlar };
    }, { timeout: 60_000 });
  }

  async geriAl(id: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.maliyetDagitimi.findUnique({ where: { id }, include: { paylar: { select: { stokId: true, fatura: { select: { no: true, tarih: true } } } } } });
      if (!d) throw new NotFoundException("Maliyet dağıtımı bulunamadı");
      if (d.durum !== "aktif") throw new BadRequestException("Dağıtım zaten geri alınmış");
      const acik = await this.maliyet.acikDonemBaslangici(tx);
      const kapali = acik ? d.paylar.find((p) => p.fatura.tarih < acik) : undefined;
      if (kapali) throw new ConflictException(`${kapali.fatura.no ?? "Hedef fatura"} kapalı dönemde; dağıtım geri alınamaz`);
      await tx.maliyetDagitimi.update({ where: { id }, data: { durum: "iptal", iptalEdenId: userId, iptalTarihi: new Date() } });
      const kartlar = await this.kartlariYenile(tx, d.paylar.map((p) => p.stokId));
      await tx.auditLog.create({ data: { tenantId, userId, islem: "maliyet_dagitimi_geri_al", varlik: "maliyet_dagitimi", varlikId: id, detay: { tutar: d.tutar.toFixed(2), kartlar } as Prisma.InputJsonValue } });
      return { id, kartlar };
    }, { timeout: 60_000 });
  }

  /** Etkilenen kartların maliyetini yeniden hesaplar; kart başına eski/yeni ortalama döner. */
  private async kartlariYenile(tx: Tx, stokIdler: string[]) {
    const calismaId = randomUUID();
    const sonuc = [];
    for (const stokId of [...new Set(stokIdler)].sort()) {
      const k = await this.maliyet.kartiUygula(tx, stokId, calismaId);
      if (k) sonuc.push({ kod: k.kod, ad: k.ad, eskiOrtalama: k.eskiOrtalama, yeniOrtalama: k.yeniOrtalama, degisenHareket: k.degisenHareket });
    }
    return sonuc;
  }

  async listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.maliyetDagitimi.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        masraf: { select: { belgeNo: true, saticiUnvan: true, kategori: { select: { ad: true } } } },
        faturaSatir: { select: { fatura: { select: { no: true } }, stok: { select: { ad: true } } } },
        paylar: { select: { tutar: true, fatura: { select: { id: true, no: true } }, stok: { select: { kod: true, ad: true } } } },
      },
    }));
  }

  /** Formun seçenekleri: dağıtılmamış giderler ve açık dönemdeki kesin alış faturaları. */
  async adaylar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const acik = await this.maliyet.acikDonemBaslangici(tx);
      const tarihKosulu = acik ? { tarih: { gte: acik } } : {};
      const [masraflar, hizmetSatirlari, faturalar] = await Promise.all([
        tx.masraf.findMany({
          where: { durum: "onaylandi", ...tarihKosulu, maliyetDagitimlari: { none: { durum: "aktif" } } },
          orderBy: { tarih: "desc" }, take: 100,
          select: { id: true, tarih: true, belgeNo: true, saticiUnvan: true, matrah: true, kur: true, dovizCinsi: true, kategori: { select: { ad: true } } },
        }),
        tx.faturaSatir.findMany({
          where: { stok: { tip: "hizmet" }, fatura: { tip: "alis", durum: "kesin", ...tarihKosulu }, maliyetDagitimlari: { none: { durum: "aktif" } } },
          orderBy: { fatura: { tarih: "desc" } }, take: 100,
          select: { id: true, matrah: true, stok: { select: { ad: true } }, fatura: { select: { id: true, no: true, tarih: true, kur: true, dovizCinsi: true, cari: { select: { unvan: true } } } } },
        }),
        tx.fatura.findMany({
          where: { tip: "alis", durum: "kesin", ...tarihKosulu, satirlar: { some: { stok: { tip: { not: "hizmet" } } } } },
          orderBy: { tarih: "desc" }, take: 200,
          select: { id: true, no: true, tarih: true, genelToplam: true, dovizCinsi: true, cari: { select: { unvan: true } } },
        }),
      ]);
      return {
        acikBaslangic: acik ? acik.toISOString().slice(0, 10) : null,
        masraflar: masraflar.map((m) => ({ id: m.id, tarih: m.tarih, etiket: `${m.belgeNo ?? m.saticiUnvan ?? "Masraf"} · ${m.kategori.ad}`, tutarTl: m.matrah.mul(m.kur).toFixed(2) })),
        hizmetSatirlari: hizmetSatirlari.map((s) => ({ id: s.id, tarih: s.fatura.tarih, etiket: `${s.fatura.no ?? "Alış faturası"} · ${s.fatura.cari.unvan} · ${s.stok.ad}`, faturaId: s.fatura.id, tutarTl: s.matrah.mul(s.fatura.kur).toFixed(2) })),
        faturalar: faturalar.map((f) => ({ id: f.id, no: f.no, tarih: f.tarih, cari: f.cari.unvan, genelToplam: f.genelToplam.toFixed(2), dovizCinsi: f.dovizCinsi })),
      };
    });
  }
}
