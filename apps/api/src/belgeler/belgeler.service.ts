import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BelgeTur, Prisma, ZincirBelgeDurum } from "@prisma/client";
import {
  faturaHesapla,
  type FaturaHesaplaSatirGirdi,
  type KayitEylem,
} from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PdfService } from "../core/pdf/pdf.service";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "../stok/depo.service";
import { belgePdfHtml } from "./belge-pdf";
import type {
  belgeGuncelleSemasi,
  belgeOlusturSemasi,
  topluFaturaSemasi,
} from "./belgeler.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

/** Belge zinciri (FTR-12): teklif → sipariş → irsaliye → fatura. */

const NO_ONEKLERI: Record<BelgeTur, string> = {
  teklif: "TKF",
  siparis: "SIP",
  irsaliye: "IRS",
};

/** Geçerli dönüşüm hedefleri (FTR-12 zinciri; sipariş faturaya atlayabilir). */
const DONUSUM_HEDEFLERI: Record<BelgeTur, ("siparis" | "irsaliye" | "fatura")[]> = {
  teklif: ["siparis"],
  siparis: ["irsaliye", "fatura"],
  irsaliye: ["fatura"],
};

type BelgeSatirKaydi = {
  stokId: string;
  miktar: Prisma.Decimal;
  birim: string;
  birimFiyat: Prisma.Decimal;
  iskontoOrani: Prisma.Decimal;
  iskontoTutari: Prisma.Decimal;
  genelIskontoPayi: Prisma.Decimal;
  matrah: Prisma.Decimal;
  kdvOrani: Prisma.Decimal;
  kdvTutari: Prisma.Decimal;
  tevkifatPay: number | null;
  tevkifatPayda: number | null;
  tevkifatTutari: Prisma.Decimal;
  netKdvTutari: Prisma.Decimal;
  toplamTutar: Prisma.Decimal;
};

@Injectable()
export class BelgelerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly depoService: DepoService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listele(
    tur?: string,
    yon?: string,
    durum?: string,
    arama?: string,
    baslangic?: string,
    bitis?: string,
    imlec?: string,
    adet = 50,
  ) {
    const ctx = aktifBaglam();
    const baslangicTarihi = baslangic ? new Date(baslangic) : null;
    const bitisTarihi = bitis ? new Date(bitis) : null;
    if (baslangicTarihi && Number.isNaN(baslangicTarihi.getTime())) throw new BadRequestException("Başlangıç tarihi geçersiz");
    if (bitisTarihi && Number.isNaN(bitisTarihi.getTime())) throw new BadRequestException("Bitiş tarihi geçersiz");
    if (baslangicTarihi && bitisTarihi && baslangicTarihi > bitisTarihi) throw new BadRequestException("Başlangıç tarihi bitiş tarihinden sonra olamaz");
    const where: Prisma.BelgeWhereInput = {
      ...(tur ? { tur: tur as BelgeTur } : {}),
      ...(yon ? { yon: yon as "satis" | "alis" } : {}),
      ...(durum ? { durum: durum as ZincirBelgeDurum } : {}),
      ...(baslangicTarihi || bitisTarihi ? { tarih: { ...(baslangicTarihi ? { gte: baslangicTarihi } : {}), ...(bitisTarihi ? { lte: bitisTarihi } : {}) } } : {}),
      ...(arama
        ? {
            OR: [
              { no: { contains: arama, mode: "insensitive" } },
              { cari: { unvan: { contains: arama, mode: "insensitive" } } },
              { cari: { kod: { contains: arama, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const kayitlar = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.belge.findMany({
        where,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: { cari: { select: { id: true, kod: true, unvan: true } } },
      }),
    );
    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet].id : null;
    return {
      kayitlar: kayitlar.slice(0, adet).map((k) => ({
        ...this.gorunum(k),
        cari: k.cari,
        izinliEylemler: this.eylemler(k),
      })),
      sonrakiImlec,
    };
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, kod: true, unvan: true, vknTckn: true } },
          satirlar: { include: { stok: { select: { id: true, kod: true, ad: true } } } },
          kaynakBelge: { select: {
            id: true, tur: true, no: true, durum: true,
            kaynakBelge: { select: { id: true, tur: true, no: true, durum: true } },
          } },
          turetilenler: { select: {
            id: true, tur: true, no: true, durum: true,
            turetilenler: { select: { id: true, tur: true, no: true, durum: true } },
          } },
          fatura: {
            select: {
              id: true, no: true, durum: true, genelToplam: true,
              ebelge: { select: { tur: true, durum: true } },
              kasaBankaHarekets: { select: { tutar: true } },
            },
          },
        },
      }),
    );
    if (!kayit) throw new NotFoundException("Belge bulunamadı");
    const zincirBelgeleri = new Map<string, { id: string; tur: BelgeTur; no: string | null; durum: ZincirBelgeDurum }>();
    const zincireEkle = (belge: { id: string; tur: BelgeTur; no: string | null; durum: ZincirBelgeDurum } | null | undefined) => {
      if (belge) zincirBelgeleri.set(belge.id, { id: belge.id, tur: belge.tur, no: belge.no, durum: belge.durum });
    };
    zincireEkle(kayit.kaynakBelge?.kaynakBelge);
    zincireEkle(kayit.kaynakBelge);
    zincireEkle(kayit);
    for (const turetilen of kayit.turetilenler) {
      zincireEkle(turetilen);
      for (const altBelge of turetilen.turetilenler) zincireEkle(altBelge);
    }
    return {
      ...this.gorunum(kayit),
      cari: kayit.cari,
      satirlar: kayit.satirlar.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        stokKod: s.stok.kod,
        stokAd: s.stok.ad,
        miktar: s.miktar.toFixed(3),
        birim: s.birim,
        birimFiyat: s.birimFiyat.toFixed(4),
        iskontoOrani: s.iskontoOrani.toFixed(2),
        matrah: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        kdvTutari: s.kdvTutari.toFixed(2),
        toplamTutar: s.toplamTutar.toFixed(2),
      })),
      // Zincir izleme (FTR-12): tüm teklif, sipariş ve irsaliye halkaları
      zincirBelgeleri: [...zincirBelgeleri.values()],
      kaynakBelge: kayit.kaynakBelge,
      turetilenler: kayit.turetilenler,
      fatura: kayit.fatura ? (() => {
        const odenen = kayit.fatura.kasaBankaHarekets.reduce((toplam, hareket) => toplam.add(hareket.tutar), D(0));
        const kalan = Prisma.Decimal.max(kayit.fatura.genelToplam.sub(odenen), 0);
        return {
          id: kayit.fatura.id,
          no: kayit.fatura.no,
          durum: kayit.fatura.durum,
          ebelge: kayit.fatura.ebelge,
          odemeOzeti: {
            durum: kayit.fatura.durum !== "kesin" ? "beklemede" : kalan.isZero() ? "odendi" : odenen.greaterThan(0) ? "kismi" : "odenmedi",
            odenen: odenen.toFixed(2),
            kalan: kalan.toFixed(2),
          },
        };
      })() : null,
      izinliEylemler: this.eylemler(kayit),
    };
  }

  async olustur(girdi: z.infer<typeof belgeOlusturSemasi>) {
    const { tenantId, userId } = aktifBaglam();

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(girdi.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of girdi.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    const hesap = this.hesapla(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.create({
        data: {
          tenantId,
          tur: girdi.tur,
          yon: girdi.yon,
          tarih: new Date(girdi.tarih),
          gecerlilikTarihi:
            girdi.tur === "teklif" && girdi.gecerlilikTarihi
              ? new Date(girdi.gecerlilikTarihi)
              : null,
          cariId: girdi.cariId,
          depoId: girdi.depoId ?? null,
          dovizCinsi: girdi.dovizCinsi,
          kur: D(girdi.kur),
          genelIskontoYuzdesi: D(girdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(girdi.genelIskontoTutari),
          ...this.toplamAlanlari(hesap),
          aciklama: girdi.aciklama,
          notlar: girdi.notlar,
        },
      });
      await this.satirlariYaz(tx, belge.id, hesap.satirlar, girdi.satirlar);
      return this.gorunum(belge);
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof belgeGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.getir(id);
    if (mevcut.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak belgeler güncellenebilir");
    }
    const birlesik = {
      tarih: girdi.tarih ?? mevcut.tarih,
      gecerlilikTarihi: girdi.gecerlilikTarihi ?? mevcut.gecerlilikTarihi,
      cariId: girdi.cariId ?? mevcut.cariId,
      depoId: girdi.depoId !== undefined ? girdi.depoId : mevcut.depoId,
      dovizCinsi: girdi.dovizCinsi ?? (mevcut.dovizCinsi as "TRY" | "USD" | "EUR"),
      kur: girdi.kur ?? mevcut.kur,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ?? mevcut.genelIskontoYuzdesi,
      genelIskontoTutari: girdi.genelIskontoTutari ?? mevcut.genelIskontoTutari,
      aciklama: girdi.aciklama ?? mevcut.aciklama,
      notlar: girdi.notlar ?? mevcut.notlar,
      satirlar:
        girdi.satirlar ??
        mevcut.satirlar.map((s) => ({
          stokId: s.stokId,
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          kdvOrani: s.kdvOrani,
          tevkifatPay: null,
          tevkifatPayda: null,
        })),
    };

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const { userId } = aktifBaglam();
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(birlesik.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of birlesik.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    const hesap = this.hesapla(birlesik);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.belgeSatir.deleteMany({ where: { belgeId: id } });
      await this.satirlariYaz(tx, id, hesap.satirlar, birlesik.satirlar);
      const belge = await tx.belge.update({
        where: { id },
        data: {
          tarih: new Date(birlesik.tarih),
          gecerlilikTarihi: birlesik.gecerlilikTarihi
            ? new Date(birlesik.gecerlilikTarihi)
            : null,
          cariId: birlesik.cariId,
          depoId: birlesik.depoId ?? null,
          dovizCinsi: birlesik.dovizCinsi,
          kur: D(birlesik.kur),
          genelIskontoYuzdesi: D(birlesik.genelIskontoYuzdesi),
          genelIskontoTutari: D(birlesik.genelIskontoTutari),
          ...this.toplamAlanlari(hesap),
          aciklama: birlesik.aciklama,
          notlar: birlesik.notlar,
        },
      });
      return this.gorunum(belge);
    });
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const belge = await this.getir(id);
    if (belge.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak belgeler silinebilir");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.delete({ where: { id } }),
    );
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      }),
    );

    if (!belge) throw new NotFoundException("Belge bulunamadı");

    const ctx = aktifBaglam();
    if (!eylemIzinli("belge", "kopyala", { durum: belge.durum }, ctx)) {
      throw new ForbiddenException("Bu belge kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    const yeni = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.belge.create({
        data: {
          tenantId,
          tur: belge.tur,
          yon: belge.yon,
          durum: "taslak",
          no: null,
          tarih: new Date(),
          gecerlilikTarihi: null,
          cariId: belge.cariId,
          depoId: belge.depoId,
          dovizCinsi: belge.dovizCinsi,
          kur: belge.kur,
          genelIskontoYuzdesi: belge.genelIskontoYuzdesi,
          genelIskontoTutari: belge.genelIskontoTutari,
          toplamBrut: belge.toplamBrut,
          toplamSatirIskontosu: belge.toplamSatirIskontosu,
          genelIskontoToplam: belge.genelIskontoToplam,
          toplamMatrah: belge.toplamMatrah,
          toplamKdv: belge.toplamKdv,
          toplamTevkifat: belge.toplamTevkifat,
          toplamNetKdv: belge.toplamNetKdv,
          genelToplam: belge.genelToplam,
          aciklama: belge.aciklama ? `${belge.aciklama} (Kopya)` : "Kopya",
          notlar: belge.notlar,
          kaynakBelgeId: null,
          faturaId: null,
        },
      });

      for (const s of belge.satirlar) {
        await tx.belgeSatir.create({
          data: {
            tenantId,
            belgeId: kopya.id,
            stokId: s.stokId,
            miktar: s.miktar,
            birim: s.birim,
            birimFiyat: s.birimFiyat,
            iskontoOrani: s.iskontoOrani,
            iskontoTutari: s.iskontoTutari,
            genelIskontoPayi: s.genelIskontoPayi,
            matrah: s.matrah,
            kdvOrani: s.kdvOrani,
            kdvTutari: s.kdvTutari,
            tevkifatPay: s.tevkifatPay,
            tevkifatPayda: s.tevkifatPayda,
            tevkifatTutari: s.tevkifatTutari,
            netKdvTutari: s.netKdvTutari,
            toplamTutar: s.toplamTutar,
          },
        });
      }

      return kopya;
    });

    return this.getir(yeni.id);
  }

  // ─── ONAY / İPTAL (rezervasyon ve yoldaki stok burada) ───────────────────

  async onayla(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.durum !== "taslak") {
        throw new BadRequestException("Yalnızca taslak belgeler onaylanabilir");
      }

      const yil = belge.tarih.getFullYear();
      const sayac = await tx.belgeSayac.upsert({
        where: { tenantId_tur_yil: { tenantId, tur: belge.tur, yil } },
        create: { tenantId, tur: belge.tur, yil, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      const no = `${NO_ONEKLERI[belge.tur]}${yil}${String(sayac.sonSira).padStart(6, "0")}`;

      // Otomatik rezervasyon (S-01): satış siparişi rezerv, alış yoldaki üretir
      if (belge.tur === "siparis") {
        await this.siparisEtkisiUygula(tx, belge.yon, belge.satirlar, +1, belge.depoId);
      }

      const guncel = await tx.belge.update({
        where: { id },
        data: { durum: "onaylandi", no },
      });
      return this.gorunum(guncel);
    });
  }

  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.durum === "kapandi" || belge.durum === "iptal") {
        throw new BadRequestException(
          "Kapanmış veya iptal edilmiş belge iptal edilemez",
        );
      }
      // Onaylı siparişin rezervi/yoldakisi çözülür
      if (belge.durum === "onaylandi" && belge.tur === "siparis") {
        await this.siparisEtkisiUygula(tx, belge.yon, belge.satirlar, -1, belge.depoId);
      }
      const guncel = await tx.belge.update({
        where: { id },
        data: { durum: "iptal" },
      });
      return this.gorunum(guncel);
    });
  }

  // ─── DÖNÜŞTÜRME (FTR-12 zinciri) ──────────────────────────────────────────

  async donustur(id: string, hedef: "siparis" | "irsaliye" | "fatura") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belge = await tx.belge.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!belge) throw new NotFoundException("Belge bulunamadı");
      if (belge.durum !== "onaylandi") {
        throw new BadRequestException(
          "Yalnızca onaylanmış belgeler dönüştürülebilir",
        );
      }
      if (!DONUSUM_HEDEFLERI[belge.tur].includes(hedef)) {
        throw new BadRequestException(
          `${belge.tur} → ${hedef} dönüşümü zincire uygun değil (teklif → sipariş → irsaliye → fatura)`,
        );
      }

      if (hedef === "fatura") {
        const fatura = await this.faturaTaslagiYaz(tx, tenantId, [belge]);
        await tx.belge.update({
          where: { id },
          data: { durum: "kapandi", faturaId: fatura.id },
        });
        return { donusenTur: "fatura" as const, faturaId: fatura.id };
      }

      // Teklif → sipariş rezervasyon üretmez; yeni sipariş önce taslak olur,
      // rezerv onayında konur. Sipariş → irsaliyede rezerv sürer (stok
      // düşümü faturada olduğundan mal hâlâ rezerve sayılır).
      const yeni = await tx.belge.create({
        data: {
          tenantId,
          tur: hedef,
          yon: belge.yon,
          tarih: new Date(),
          cariId: belge.cariId,
          // Zincir boyunca aynı depo taşınır (STK-07)
          depoId: belge.depoId,
          dovizCinsi: belge.dovizCinsi,
          kur: belge.kur,
          genelIskontoYuzdesi: belge.genelIskontoYuzdesi,
          genelIskontoTutari: belge.genelIskontoTutari,
          toplamBrut: belge.toplamBrut,
          toplamSatirIskontosu: belge.toplamSatirIskontosu,
          genelIskontoToplam: belge.genelIskontoToplam,
          toplamMatrah: belge.toplamMatrah,
          toplamKdv: belge.toplamKdv,
          toplamTevkifat: belge.toplamTevkifat,
          toplamNetKdv: belge.toplamNetKdv,
          genelToplam: belge.genelToplam,
          aciklama: belge.aciklama,
          notlar: belge.notlar,
          kaynakBelgeId: belge.id,
        },
      });
      await tx.belgeSatir.createMany({
        data: belge.satirlar.map((s) => ({
          tenantId,
          belgeId: yeni.id,
          stokId: s.stokId,
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          iskontoTutari: s.iskontoTutari,
          genelIskontoPayi: s.genelIskontoPayi,
          matrah: s.matrah,
          kdvOrani: s.kdvOrani,
          kdvTutari: s.kdvTutari,
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          tevkifatTutari: s.tevkifatTutari,
          netKdvTutari: s.netKdvTutari,
          toplamTutar: s.toplamTutar,
        })),
      });

      // Sipariş → irsaliye dönüşümünde rezerv taşınmalı: kaynak sipariş
      // kapanır ama rezerv, zincir fatura kesinleşene dek sürer; bu yüzden
      // burada rezerv ÇÖZÜLMEZ. Teklif → siparişte yeni sipariş taslaktır,
      // rezerv onayla gelir.
      await tx.belge.update({ where: { id }, data: { durum: "kapandi" } });
      return { donusenTur: hedef, belgeId: yeni.id };
    });
  }

  // ─── TOPLU FATURALAMA (FTR-13) ───────────────────────────────────────────

  async topluFatura(girdi: z.infer<typeof topluFaturaSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const belgeler = await tx.belge.findMany({
        where: { id: { in: girdi.belgeIds } },
        include: { satirlar: true },
      });
      if (belgeler.length !== girdi.belgeIds.length) {
        throw new NotFoundException("Seçilen belgelerden bazıları bulunamadı");
      }
      for (const b of belgeler) {
        if (b.durum !== "onaylandi") {
          throw new BadRequestException(
            `${b.no ?? b.id} bekleyen (onaylanmış) durumda değil`,
          );
        }
        if (b.tur === "teklif") {
          throw new BadRequestException(
            "Teklifler doğrudan faturalanamaz; önce siparişe dönüştürün",
          );
        }
      }
      const ilk = belgeler[0];
      if (
        !belgeler.every(
          (b) =>
            b.cariId === ilk.cariId &&
            b.dovizCinsi === ilk.dovizCinsi &&
            b.kur.equals(ilk.kur) &&
            b.yon === ilk.yon &&
            b.depoId === ilk.depoId,
        )
      ) {
        throw new BadRequestException(
          "Toplu faturalama için belgeler aynı cari, döviz, kur, yön ve depoda olmalıdır",
        );
      }

      const fatura = await this.faturaTaslagiYaz(tx, tenantId, belgeler);
      const kapananlar = await tx.belge.updateMany({
        where: {
          id: { in: girdi.belgeIds },
          durum: "onaylandi",
          faturaId: null,
        },
        data: { durum: "kapandi", faturaId: fatura.id },
      });
      if (kapananlar.count !== belgeler.length) {
        throw new ConflictException(
          "Seçilen belgelerden biri başka bir işlemde faturalanmış; listeyi yenileyip tekrar deneyin",
        );
      }
      return { faturaId: fatura.id, birlesenBelge: belgeler.length };
    });
  }

  // ─── PDF (T-02) ──────────────────────────────────────────────────────────

  async pdfUret(id: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const belge = await this.getir(id);
    const { tenantId } = aktifBaglam();
    const firma = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { unvan: true, vkn: true, vergiDairesi: true },
      }),
    );
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const logoDataUri = await this.pdf.firmaLogoDataUri();
    const buffer = await this.pdf.htmlToPdf(
      belgePdfHtml(belge, { ...firma, logoDataUri }),
    );
    return { buffer, dosyaAdi: `belge-${belge.no ?? "taslak"}.pdf` };
  }

  // ─── YARDIMCILAR ─────────────────────────────────────────────────────────

  /**
   * Satış siparişi rezerv, alış siparişi yoldaki miktarını günceller.
   * isaret: +1 onay, -1 iptal/çözüm. Miktarlar fatura ile aynı kabulle
   * satır miktarı üzerinden işlenir. Kart üzerindeki toplamla birlikte
   * siparişin deposunun bakiyesi de güncellenir (STK-07).
   */
  async siparisEtkisiUygula(
    tx: Prisma.TransactionClient,
    yon: "satis" | "alis",
    satirlar: { stokId: string; miktar: Prisma.Decimal }[],
    isaret: 1 | -1,
    depoId?: string | null,
  ): Promise<void> {
    const alan = yon === "satis" ? "rezerveMiktar" : "yoldakiMiktar";
    const hedefDepoId = await this.depoService.depoCozumle(tx, depoId);
    for (const s of satirlar) {
      await tx.stokKart.update({
        where: { id: s.stokId },
        data: {
          [alan]:
            isaret > 0 ? { increment: s.miktar } : { decrement: s.miktar },
        },
      });
      await this.depoService.bakiyeDegistir(
        tx,
        s.stokId,
        hedefDepoId,
        alan,
        isaret > 0 ? s.miktar : s.miktar.negated(),
      );
    }
  }

  /** Belgelerin satırlarını birleştirip fatura TASLAĞI yazar (stok/cari etkisi kesinleştirmede). */
  private async faturaTaslagiYaz(
    tx: Prisma.TransactionClient,
    tenantId: string,
    belgeler: {
      yon: string;
      cariId: string;
      depoId: string | null;
      dovizCinsi: "TRY" | "USD" | "EUR";
      kur: Prisma.Decimal;
      no: string | null;
      satirlar: BelgeSatirKaydi[];
    }[],
  ) {
    const ilk = belgeler[0];
    const tumSatirlar = belgeler.flatMap((b) => b.satirlar);
    // Genel iskonto payları belge bazında zaten satırlara dağıtılmış olabilir;
    // faturada genel iskonto sıfırlanır, satır değerleri yeniden hesaplanır.
    const hesap = this.hesapla({
      genelIskontoYuzdesi: "0",
      genelIskontoTutari: "0",
      satirlar: tumSatirlar.map((s) => ({
        stokId: s.stokId,
        miktar: s.miktar,
        birim: s.birim,
        birimFiyat: s.birimFiyat,
        iskontoOrani: s.iskontoOrani,
        kdvOrani: s.kdvOrani,
        tevkifatPay: s.tevkifatPay,
        tevkifatPayda: s.tevkifatPayda,
      })),
    });
    const kaynakNolar = belgeler.map((b) => b.no).filter(Boolean).join(", ");
    const fatura = await tx.fatura.create({
      data: {
        tenantId,
        tip: ilk.yon === "satis" ? "satis" : "alis",
        durum: "taslak",
        tarih: new Date(),
        cariId: ilk.cariId,
        // Depo zincirden faturaya taşınır; boşsa kesinleştirmede varsayılana çözülür
        depoId: ilk.depoId,
        dovizCinsi: ilk.dovizCinsi,
        kur: ilk.kur,
        genelIskontoYuzdesi: D(0),
        genelIskontoTutari: D(0),
        ...this.toplamAlanlari(hesap),
        aciklama: kaynakNolar ? `Belge zincirinden: ${kaynakNolar}` : null,
      },
    });
    for (const [i, s] of hesap.satirlar.entries()) {
      await tx.faturaSatir.create({
        data: {
          tenantId,
          faturaId: fatura.id,
          stokId: s.stokId,
          miktar: D(s.miktar),
          birim: tumSatirlar[i].birim,
          birimFiyat: D(s.birimFiyat),
          iskontoOrani: D(s.iskontoOrani),
          iskontoTutari: D(s.iskontoTutari),
          genelIskontoPayi: D(s.genelIskontoPayi),
          matrah: D(s.matrah),
          kdvOrani: D(s.kdvOrani),
          kdvTutari: D(s.kdvTutari),
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          tevkifatTutari: D(s.tevkifatTutari),
          netKdvTutari: D(s.netKdvTutari),
          toplamTutar: D(s.toplamTutar),
        },
      });
    }
    return fatura;
  }

  private async satirlariYaz(
    tx: Prisma.TransactionClient,
    belgeId: string,
    hesapSatirlari: ReturnType<typeof faturaHesapla>["satirlar"],
    girdiSatirlari: { birim?: string }[],
  ): Promise<void> {
    const { tenantId } = aktifBaglam();
    for (const [i, s] of hesapSatirlari.entries()) {
      await tx.belgeSatir.create({
        data: {
          tenantId,
          belgeId,
          stokId: s.stokId,
          miktar: D(s.miktar),
          birim: girdiSatirlari[i]?.birim ?? "adet",
          birimFiyat: D(s.birimFiyat),
          iskontoOrani: D(s.iskontoOrani),
          iskontoTutari: D(s.iskontoTutari),
          genelIskontoPayi: D(s.genelIskontoPayi),
          matrah: D(s.matrah),
          kdvOrani: D(s.kdvOrani),
          kdvTutari: D(s.kdvTutari),
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          tevkifatTutari: D(s.tevkifatTutari),
          netKdvTutari: D(s.netKdvTutari),
          toplamTutar: D(s.toplamTutar),
        },
      });
    }
  }

  private hesapla(girdi: {
    satirlar: {
      stokId: string;
      miktar: string | number | Prisma.Decimal;
      birimFiyat: string | number | Prisma.Decimal;
      iskontoOrani: string | number | Prisma.Decimal;
      kdvOrani: string | number | Prisma.Decimal;
      tevkifatPay?: number | null;
      tevkifatPayda?: number | null;
    }[];
    genelIskontoYuzdesi?: string | number | Prisma.Decimal;
    genelIskontoTutari?: string | number | Prisma.Decimal;
  }) {
    const satirlar: FaturaHesaplaSatirGirdi[] = girdi.satirlar.map((s) => ({
      stokId: s.stokId,
      miktar: Number(s.miktar),
      birimFiyat: Number(s.birimFiyat),
      iskontoOrani: Number(s.iskontoOrani),
      kdvOrani: Number(s.kdvOrani),
      tevkifatPay: s.tevkifatPay || undefined,
      tevkifatPayda: s.tevkifatPayda || undefined,
    }));
    return faturaHesapla({
      satirlar,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi
        ? Number(girdi.genelIskontoYuzdesi)
        : 0,
      genelIskontoTutari: girdi.genelIskontoTutari
        ? Number(girdi.genelIskontoTutari)
        : 0,
    });
  }

  private toplamAlanlari(hesap: ReturnType<typeof faturaHesapla>) {
    return {
      toplamBrut: D(hesap.toplamBrut),
      toplamSatirIskontosu: D(hesap.toplamSatirIskontosu),
      genelIskontoToplam: D(hesap.genelIskontoTutari),
      toplamMatrah: D(hesap.toplamMatrah),
      toplamKdv: D(hesap.toplamKdv),
      toplamTevkifat: D(hesap.toplamTevkifat),
      toplamNetKdv: D(hesap.toplamNetKdv),
      genelToplam: D(hesap.genelToplam),
    };
  }

  private eylemler(kayit: { durum: string }): KayitEylem[] {
    return izinliEylemler("belge", { durum: kayit.durum }, aktifBaglam());
  }

  private gorunum(k: {
    id: string;
    tur: string;
    yon: string;
    durum: string;
    no: string | null;
    tarih: Date;
    gecerlilikTarihi: Date | null;
    cariId: string;
    depoId: string | null;
    dovizCinsi: string;
    kur: Prisma.Decimal;
    genelIskontoYuzdesi: Prisma.Decimal;
    genelIskontoTutari: Prisma.Decimal;
    toplamBrut: Prisma.Decimal;
    toplamSatirIskontosu: Prisma.Decimal;
    genelIskontoToplam: Prisma.Decimal;
    toplamMatrah: Prisma.Decimal;
    toplamKdv: Prisma.Decimal;
    toplamTevkifat: Prisma.Decimal;
    toplamNetKdv: Prisma.Decimal;
    genelToplam: Prisma.Decimal;
    aciklama: string | null;
    notlar: string | null;
    kaynakBelgeId: string | null;
    faturaId: string | null;
  }) {
    return {
      id: k.id,
      tur: k.tur,
      yon: k.yon,
      durum: k.durum,
      no: k.no,
      tarih: k.tarih.toISOString().slice(0, 10),
      gecerlilikTarihi: k.gecerlilikTarihi?.toISOString().slice(0, 10) ?? null,
      cariId: k.cariId,
      depoId: k.depoId,
      dovizCinsi: k.dovizCinsi,
      kur: D(k.kur).toFixed(4),
      genelIskontoYuzdesi: D(k.genelIskontoYuzdesi).toFixed(2),
      genelIskontoTutari: D(k.genelIskontoTutari).toFixed(2),
      toplamBrut: D(k.toplamBrut).toFixed(2),
      toplamSatirIskontosu: D(k.toplamSatirIskontosu).toFixed(2),
      genelIskontoToplam: D(k.genelIskontoToplam).toFixed(2),
      toplamMatrah: D(k.toplamMatrah).toFixed(2),
      toplamKdv: D(k.toplamKdv).toFixed(2),
      toplamTevkifat: D(k.toplamTevkifat).toFixed(2),
      toplamNetKdv: D(k.toplamNetKdv).toFixed(2),
      genelToplam: D(k.genelToplam).toFixed(2),
      aciklama: k.aciklama,
      notlar: k.notlar,
      kaynakBelgeId: k.kaynakBelgeId,
      faturaId: k.faturaId,
    };
  }
}
