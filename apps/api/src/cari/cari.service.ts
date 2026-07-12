import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import type {
  adresSemasi,
  bankaHesapSemasi,
  cariGuncelleSemasi,
  CariHareketGirdisi,
  CariOlusturGirdisi,
  etiketSemasi,
  kisiSemasi,
} from "./cari.semalar";
import { yaslandir } from "./yaslandirma";
import { cariExcelOku, cariEkstreExcelYaz } from "../core/excel-yardimci";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

export interface DovizBakiye {
  dovizCinsi: string;
  borc: string;
  alacak: string;
  bakiye: string;
}

@Injectable()
export class CariService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(arama?: string, imlec?: string, adet = 50) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findMany({
        where: arama
          ? {
              OR: [
                { unvan: { contains: arama, mode: "insensitive" } },
                { kod: { contains: arama, mode: "insensitive" } },
                { vknTckn: { contains: arama } },
              ],
            }
          : undefined,
        orderBy: { kod: "asc" },
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet].id : null;
    const sayfa = kayitlar.slice(0, adet);
    const bakiyeler = await this.bakiyeleriGetir(sayfa.map((k) => k.id));
    return {
      kayitlar: sayfa.map((k) => ({
        ...this.gorunum(k),
        bakiyeler: bakiyeler.get(k.id) ?? [],
        izinliEylemler: this.eylemler(k, ctx.rol, k._count.hareketler),
      })),
      sonrakiImlec,
    };
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.cariHesap.findUnique({
        where: { id },
        include: {
          adresler: true,
          kisiler: true,
          bankaHesaplari: true,
          etiketler: { include: { etiket: true } },
          temsilci: { select: { id: true, adSoyad: true } },
          fiyatListesi: { select: { id: true, ad: true } },
          _count: { select: { hareketler: true } },
        },
      }),
    );
    if (!kayit) throw new NotFoundException("Cari bulunamadı");
    const bakiyeler = (await this.bakiyeleriGetir([id])).get(id) ?? [];
    const tryBakiye = Number(
      bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? 0,
    );
    const risk = await this.riskOzeti(id, tryBakiye, kayit.riskLimiti);
    return {
      ...this.gorunum(kayit),
      adresler: kayit.adresler,
      kisiler: kayit.kisiler,
      bankaHesaplari: kayit.bankaHesaplari,
      etiketler: kayit.etiketler.map((a) => a.etiket),
      temsilci: kayit.temsilci,
      fiyatListesi: kayit.fiyatListesi,
      bakiyeler,
      risk,
      riskAsimi: risk.asim,
      finansalOzet: await this.finansalOzet(id),
      izinliEylemler: this.eylemler(kayit, ctx.rol, kayit._count.hareketler),
    };
  }

  /**
   * Risk özeti (CARI-17): mevcut risk = açık TRY bakiye + portföydeki/cirolu
   * çek-senet tutarı. Limit tanımlıysa kalan limit ve aşım bilgisi döner.
   */
  private async riskOzeti(
    cariId: string,
    tryBakiye: number,
    riskLimiti: Prisma.Decimal | null,
  ) {
    const { tenantId } = aktifBaglam();
    const cekSenet = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.aggregate({
        where: { cariId, durum: { in: ["portfoyde", "ciro_edildi"] } },
        _sum: { tutarTry: true },
      }),
    );
    const cekSenetRiski = D(cekSenet._sum.tutarTry?.toString() ?? 0);
    const mevcutRisk = D(Math.max(tryBakiye, 0)).add(cekSenetRiski);
    const limit = riskLimiti ? D(riskLimiti.toString()) : null;
    return {
      cekSenetRiski: cekSenetRiski.toFixed(2),
      mevcutRisk: mevcutRisk.toFixed(2),
      limit: limit?.toFixed(2) ?? null,
      kalanLimit: limit ? limit.sub(mevcutRisk).toFixed(2) : null,
      asim: limit !== null && mevcutRisk.greaterThan(limit),
    };
  }

  /** Hesaplanan finansal özet (CARI-18). */
  private async finansalOzet(cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [sonIslem, sonTahsilat, sonOdeme, hareketler] = await Promise.all([
        tx.cariHareket.findFirst({
          where: { cariId },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.kasaBankaHareket.findFirst({
          where: { cariId, tip: "tahsilat" },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.kasaBankaHareket.findFirst({
          where: { cariId, tip: "tediye" },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.cariHareket.findMany({
          where: { cariId },
          select: { tip: true, tutarTry: true, vadeTarihi: true, tarih: true },
        }),
      ]);
      const y = yaslandir(
        hareketler.map((h) => ({
          tip: h.tip,
          tutarTry: Number(h.tutarTry),
          vadeTarihi: h.vadeTarihi,
          tarih: h.tarih,
        })),
        new Date(),
      );
      const gun = (t?: Date | null): string | null =>
        t ? t.toISOString().slice(0, 10) : null;
      return {
        sonIslemTarihi: gun(sonIslem?.tarih),
        sonTahsilatTarihi: gun(sonTahsilat?.tarih),
        sonOdemeTarihi: gun(sonOdeme?.tarih),
        vadesiGecmisBakiye: (y.toplam - y.guncel).toFixed(2),
      };
    });
  }

  async olustur(girdi: CariOlusturGirdisi) {
    const { tenantId } = aktifBaglam();
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.create({
          data: {
            tenantId,
            ...girdi,
            kvkkOnayTarihi: girdi.kvkkOnayTarihi
              ? new Date(girdi.kvkkOnayTarihi)
              : undefined,
            varsayilanIskonto: girdi.varsayilanIskonto
              ? D(girdi.varsayilanIskonto)
              : undefined,
            riskLimiti: girdi.riskLimiti ? D(girdi.riskLimiti) : undefined,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodu zaten kullanımda`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof cariGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(id);
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.update({
        where: { id },
        data: {
          ...girdi,
          kvkkOnayTarihi: girdi.kvkkOnayTarihi
            ? new Date(girdi.kvkkOnayTarihi)
            : undefined,
          varsayilanIskonto: girdi.varsayilanIskonto
            ? D(girdi.varsayilanIskonto)
            : undefined,
          riskLimiti: girdi.riskLimiti ? D(girdi.riskLimiti) : undefined,
        },
      }),
    );
    return this.gorunum(kayit);
  }

  /** AYR-05: hareketi olan cari silinemez — pasife alınır. */
  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.count({ where: { cariId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException(
        "Hareketi olan cari silinemez; pasife alın (PATCH aktif=false)",
      );
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.delete({ where: { id } }),
    );
  }

  async adresEkle(cariId: string, girdi: z.infer<typeof adresSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariAdres.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async kisiEkle(cariId: string, girdi: z.infer<typeof kisiSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariKisi.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  // ─── BANKA HESAPLARI (CARI-16) ─────────────────────────────────────────

  async bankaHesapEkle(cariId: string, girdi: z.infer<typeof bankaHesapSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.varlikKontrol(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariBankaHesap.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async bankaHesapSil(cariId: string, hesapId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariBankaHesap.deleteMany({ where: { id: hesapId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Banka hesabı bulunamadı");
  }

  // ─── ETİKETLER (CARI-11) ───────────────────────────────────────────────

  async etiketleriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiket.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { atamalar: true } } },
      }),
    );
  }

  async etiketOlustur(girdi: z.infer<typeof etiketSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariEtiket.create({ data: { tenantId, ...girdi } }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.ad}' etiketi zaten var`);
      }
      throw hata;
    }
  }

  async etiketSil(etiketId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiket.deleteMany({ where: { id: etiketId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Etiket bulunamadı");
  }

  async etiketAta(cariId: string, etiketId: string) {
    const { tenantId } = aktifBaglam();
    await this.varlikKontrol(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiketAtama.upsert({
        where: { tenantId_cariId_etiketId: { tenantId, cariId, etiketId } },
        create: { tenantId, cariId, etiketId },
        update: {},
      }),
    );
  }

  async etiketKaldir(cariId: string, etiketId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiketAtama.deleteMany({ where: { cariId, etiketId } }),
    );
  }

  /** Detay görünümü hesaplamadan yalnız kayıt varlığını doğrular. */
  private async varlikKontrol(cariId: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findUnique({ where: { id: cariId }, select: { id: true } }),
    );
    if (!kayit) throw new NotFoundException("Cari bulunamadı");
  }

  async hareketEkle(cariId: string, girdi: CariHareketGirdisi) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.create({
        data: {
          tenantId,
          cariId,
          tip: girdi.tip,
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry: tutar.mul(kur).toDecimalPlaces(2),
          tarih: new Date(girdi.tarih),
          vadeTarihi: girdi.vadeTarihi ? new Date(girdi.vadeTarihi) : undefined,
          aciklama: girdi.aciklama,
        },
      }),
    );
  }

  /** Ekstre (CARI-04): tarih aralığı + yürüyen bakiye (TRY). */
  async ekstre(cariId: string, baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    const cari = await this.getir(cariId);
    const hareketler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.findMany({
        where: {
          cariId,
          tarih: {
            ...(baslangic ? { gte: new Date(baslangic) } : {}),
            ...(bitis ? { lte: new Date(bitis) } : {}),
          },
        },
        orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
      }),
    );
    let bakiye = new Prisma.Decimal(0);
    const satirlar = hareketler.map((h) => {
      bakiye =
        h.tip === "borc" ? bakiye.add(h.tutarTry) : bakiye.sub(h.tutarTry);
      return {
        tarih: h.tarih.toISOString().slice(0, 10),
        vadeTarihi: h.vadeTarihi?.toISOString().slice(0, 10) ?? null,
        tip: h.tip,
        aciklama: h.aciklama,
        dovizCinsi: h.dovizCinsi,
        tutar: h.tutar.toFixed(2),
        kur: h.kur.toFixed(4),
        tutarTry: h.tutarTry.toFixed(2),
        yuruyenBakiye: bakiye.toFixed(2),
      };
    });
    return { cari: { id: cari.id, kod: cari.kod, unvan: cari.unvan }, satirlar };
  }

  // Yaşlandırma raporu RPR-06 araç setine taşındı: cari.yaslandirma (CARI-12).

  private async bakiyeleriGetir(
    cariIdler: string[],
  ): Promise<Map<string, DovizBakiye[]>> {
    if (cariIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();
    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.groupBy({
        by: ["cariId", "dovizCinsi", "tip"],
        where: { cariId: { in: cariIdler } },
        _sum: { tutar: true },
      }),
    );
    const sonuc = new Map<string, Map<string, { borc: Prisma.Decimal; alacak: Prisma.Decimal }>>();
    for (const g of gruplar) {
      const cariMap = sonuc.get(g.cariId) ?? new Map();
      const kayit = cariMap.get(g.dovizCinsi) ?? {
        borc: new Prisma.Decimal(0),
        alacak: new Prisma.Decimal(0),
      };
      if (g.tip === "borc") kayit.borc = kayit.borc.add(g._sum.tutar ?? 0);
      else kayit.alacak = kayit.alacak.add(g._sum.tutar ?? 0);
      cariMap.set(g.dovizCinsi, kayit);
      sonuc.set(g.cariId, cariMap);
    }
    const donus = new Map<string, DovizBakiye[]>();
    for (const [cariId, dovizler] of sonuc) {
      donus.set(
        cariId,
        [...dovizler.entries()].map(([doviz, t]) => ({
          dovizCinsi: doviz,
          borc: t.borc.toFixed(2),
          alacak: t.alacak.toFixed(2),
          bakiye: t.borc.sub(t.alacak).toFixed(2),
        })),
      );
    }
    return donus;
  }

  private eylemler(
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      "cari",
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }

  private gorunum(k: {
    id: string;
    kod: string;
    unvan: string;
    kisaAd: string | null;
    tip: string;
    kisiTipi: string;
    sektor: string | null;
    temsilciUserId: string | null;
    vknTckn: string | null;
    vergiDairesi: string | null;
    mersisNo: string | null;
    ticaretSicilNo: string | null;
    kvkkOnayTarihi: Date | null;
    eposta: string | null;
    telefon: string | null;
    webSitesi: string | null;
    faks: string | null;
    iban: string | null;
    karaListe: boolean;
    karaListeNotu: string | null;
    dovizCinsi: string;
    fiyatListesiId: string | null;
    varsayilanIskonto: Prisma.Decimal | null;
    varsayilanVadeGun: number | null;
    riskLimiti: Prisma.Decimal | null;
    eFaturaMukellefi: boolean | null;
    notlar: string | null;
    aktif: boolean;
  }) {
    return {
      id: k.id,
      kod: k.kod,
      unvan: k.unvan,
      kisaAd: k.kisaAd,
      tip: k.tip,
      kisiTipi: k.kisiTipi,
      sektor: k.sektor,
      temsilciUserId: k.temsilciUserId,
      vknTckn: k.vknTckn,
      vergiDairesi: k.vergiDairesi,
      mersisNo: k.mersisNo,
      ticaretSicilNo: k.ticaretSicilNo,
      kvkkOnayTarihi: k.kvkkOnayTarihi?.toISOString().slice(0, 10) ?? null,
      eposta: k.eposta,
      telefon: k.telefon,
      webSitesi: k.webSitesi,
      faks: k.faks,
      iban: k.iban,
      karaListe: k.karaListe,
      karaListeNotu: k.karaListeNotu,
      dovizCinsi: k.dovizCinsi,
      fiyatListesiId: k.fiyatListesiId,
      varsayilanIskonto: k.varsayilanIskonto?.toFixed(2) ?? null,
      varsayilanVadeGun: k.varsayilanVadeGun,
      riskLimiti: k.riskLimiti?.toFixed(2) ?? null,
      eFaturaMukellefi: k.eFaturaMukellefi,
      notlar: k.notlar,
      aktif: k.aktif,
    };
  }

  async excelImport(buffer: Buffer): Promise<{ eklenen: number }> {
    const { tenantId } = aktifBaglam();
    const cariler = await cariExcelOku(buffer);

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      for (const c of cariler) {
        await tx.cariHesap.upsert({
          where: { tenantId_kod: { tenantId, kod: c.kod } },
          create: {
            tenantId,
            kod: c.kod,
            unvan: c.unvan,
            tip: c.tip,
            vknTckn: c.vknTckn,
            eposta: c.eposta,
            telefon: c.telefon,
          },
          update: {
            unvan: c.unvan,
            tip: c.tip,
            vknTckn: c.vknTckn,
            eposta: c.eposta,
            telefon: c.telefon,
          },
        });
      }
    });

    return { eklenen: cariler.length };
  }

  async ekstreExcel(cariId: string, baslangic?: string, bitis?: string): Promise<Buffer> {
    const data = await this.ekstre(cariId, baslangic, bitis);
    const mapped = data.satirlar.map((s) => ({
      tarih: new Date(s.tarih),
      aciklama: s.aciklama || "",
      borc: s.tip === "borc" ? s.tutarTry : "",
      alacak: s.tip === "alacak" ? s.tutarTry : "",
      bakiye: s.yuruyenBakiye,
    }));

    return cariEkstreExcelYaz(data.cari, mapped);
  }
}
