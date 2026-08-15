import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import type {
  adresSemasi,
  bankaHesapSemasi,
  cariGuncelleSemasi,
  CariHareketGirdisi,
  CariOlusturGirdisi,
  etiketSemasi,
  kisiSemasi,
  crmEtkilesimSemasi,
  crmGorevSemasi,
} from "./cari.semalar";
import { yaslandir } from "./yaslandirma";
import { cariExcelOku, cariEkstreExcelYaz } from "../core/excel-yardimci";
import { PdfService } from "../core/pdf/pdf.service";
import { cariDavranisAnalizi } from "./cari-analiz";
import { EpostaService } from "../tenant/eposta.service";
import {
  kacis,
  paraBicim,
  sayfaSablonu,
  tarihBicim,
} from "../core/pdf/pdf-sablon";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

export interface DovizBakiye {
  dovizCinsi: string;
  borc: string;
  alacak: string;
  bakiye: string;
  bakiyeTry: string;
}

@Injectable()
export class CariService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
  ) {}

  async listele(arama?: string, imlec?: string, adet = 50, tip?: string, durum?: string, bakiye?: string) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findMany({
        where: {
          ...(tip === "musteri" ? { tip: { in: ["musteri", "her_ikisi"] } } : tip === "tedarikci" ? { tip: { in: ["tedarikci", "her_ikisi"] } } : {}),
          ...(durum === "bloke" ? { karaListe: true } : {}),
          ...(bakiye === "gecikmis" ? { hareketler: { some: { tip: "borc", vadeTarihi: { lt: new Date() } } } } : {}),
          ...(arama ? {
              OR: [
                { unvan: { contains: arama, mode: "insensitive" } },
                { kod: { contains: arama, mode: "insensitive" } },
                { vknTckn: { contains: arama } },
                { telefon: { contains: arama } },
              ],
            } : {}),
        },
        orderBy: [{ kod: "asc" }, { id: "asc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: { _count: { select: { hareketler: true } } },
      }),
    );
    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
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
    const tryBakiye = bakiyeler.reduce((toplam, b) => toplam + Number(b.bakiyeTry), 0);
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
    // Yalnız ALINAN çekler cari riskidir; verilen çek bizim borcumuzdur ve
    // carinin riskini artırmaz (KSB-05).
    const cekSenet = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.aggregate({
        where: { cariId, yon: "alinan", durum: { in: ["portfoyde", "ciro_edildi"] } },
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

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findUnique({
        where: { id },
        include: {
          adresler: true,
          kisiler: true,
          bankaHesaplari: true,
          etiketler: true,
        },
      }),
    );

    if (!cari) throw new NotFoundException("Cari bulunamadı");

    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.count({ where: { cariId: id } }),
    );
    const ctx = aktifBaglam();
    if (!eylemIzinli("cari", "kopyala", { aktif: cari.aktif, hareketSayisi }, ctx)) {
      throw new ForbiddenException("Bu cari kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    let yeniKod = `${cari.kod}-KOPYA`;
    let sayac = 1;
    while (true) {
      const varMi = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findUnique({ where: { tenantId_kod: { tenantId, kod: yeniKod } } }),
      );
      if (!varMi) break;
      yeniKod = `${cari.kod}-KOPYA-${sayac}`;
      sayac++;
    }

    const kopyaCari = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.cariHesap.create({
        data: {
          tenantId,
          kod: yeniKod,
          unvan: `${cari.unvan} (Kopya)`,
          kisaAd: cari.kisaAd ? `${cari.kisaAd} (Kopya)` : null,
          tip: cari.tip,
          kisiTipi: cari.kisiTipi,
          sektor: cari.sektor,
          temsilciUserId: cari.temsilciUserId,
          vknTckn: cari.vknTckn,
          vergiDairesi: cari.vergiDairesi,
          mersisNo: cari.mersisNo,
          ticaretSicilNo: cari.ticaretSicilNo,
          kvkkOnayTarihi: cari.kvkkOnayTarihi,
          eposta: cari.eposta,
          telefon: cari.telefon,
          webSitesi: cari.webSitesi,
          faks: cari.faks,
          iban: cari.iban,
          karaListe: false,
          karaListeNotu: null,
          dovizCinsi: cari.dovizCinsi,
          fiyatListesiId: cari.fiyatListesiId,
          varsayilanIskonto: cari.varsayilanIskonto,
          varsayilanVadeGun: cari.varsayilanVadeGun,
          riskLimiti: cari.riskLimiti,
          eFaturaMukellefi: cari.eFaturaMukellefi,
          mukellefiyetSorguZamani: cari.mukellefiyetSorguZamani,
          notlar: cari.notlar,
          aktif: true,
        },
      });

      for (const a of cari.adresler) {
        await tx.cariAdres.create({
          data: {
            tenantId,
            cariId: kopya.id,
            tip: a.tip,
            baslik: a.baslik,
            adres: a.adres,
            il: a.il,
            ilce: a.ilce,
            postaKodu: a.postaKodu,
            ulke: a.ulke,
          },
        });
      }

      for (const k of cari.kisiler) {
        await tx.cariKisi.create({
          data: {
            tenantId,
            cariId: kopya.id,
            adSoyad: k.adSoyad,
            gorev: k.gorev,
            telefon: k.telefon,
            eposta: k.eposta,
          },
        });
      }

      for (const b of cari.bankaHesaplari) {
        await tx.cariBankaHesap.create({
          data: {
            tenantId,
            cariId: kopya.id,
            bankaAdi: b.bankaAdi,
            subeAdi: b.subeAdi,
            hesapSahibi: b.hesapSahibi,
            iban: b.iban,
            swift: b.swift,
            paraBirimi: b.paraBirimi,
          },
        });
      }

      for (const e of cari.etiketler) {
        await tx.cariEtiketAtama.create({
          data: {
            tenantId,
            cariId: kopya.id,
            etiketId: e.etiketId,
          },
        });
      }

      return kopya;
    });

    return this.getir(kopyaCari.id);
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

  async adresGuncelle(cariId: string, adresId: string, girdi: z.infer<typeof adresSemasi>) {
    const { tenantId } = aktifBaglam();
    const adres = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariAdres.findFirst({ where: { id: adresId, cariId } }));
    if (!adres) throw new NotFoundException("Adres bulunamadı");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.cariAdres.update({ where: { id: adresId }, data: girdi }));
  }

  async adresSil(cariId: string, adresId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariAdres.deleteMany({ where: { id: adresId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Adres bulunamadı");
  }

  async kisiEkle(cariId: string, girdi: z.infer<typeof kisiSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariKisi.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async kisiSil(cariId: string, kisiId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariKisi.deleteMany({ where: { id: kisiId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("İlgili kişi bulunamadı");
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

  async crmGetir(cariId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [etkilesimler, gorevler, teklifler, kullanicilar] = await Promise.all([
        tx.crmEtkilesim.findMany({ where: { cariId }, orderBy: { tarih: "desc" }, include: { user: { select: { id: true, adSoyad: true } } } }),
        tx.crmGorev.findMany({ where: { cariId }, orderBy: [{ durum: "asc" }, { sonTarih: "asc" }, { createdAt: "desc" }], include: { atanan: { select: { id: true, adSoyad: true } } } }),
        tx.belge.findMany({ where: { cariId, tur: "teklif" }, orderBy: { tarih: "desc" }, select: { id: true, no: true, tarih: true, gecerlilikTarihi: true, durum: true, genelToplam: true, dovizCinsi: true } }),
        tx.user.findMany({ where: { aktif: true }, orderBy: { adSoyad: "asc" }, select: { id: true, adSoyad: true, rol: true } }),
      ]);
      return { etkilesimler, gorevler, teklifler, kullanicilar };
    });
  }

  async davranisAnalizi(cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({
        where: { id: cariId },
        select: {
          riskLimiti: true,
          hareketler: {
            select: { tip: true, tutarTry: true, tarih: true, vadeTarihi: true },
            orderBy: { tarih: "asc" },
          },
        },
      });
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      return cariDavranisAnalizi(
        cari.hareketler.map((h) => ({ ...h, tutarTry: Number(h.tutarTry) })),
        cari.riskLimiti === null ? null : Number(cari.riskLimiti),
      );
    });
  }

  async crmEtkilesimEkle(cariId: string, girdi: z.infer<typeof crmEtkilesimSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({ data: { tenantId, cariId, userId, tip: girdi.tip, konu: girdi.konu, aciklama: girdi.aciklama, tarih: new Date(girdi.tarih) } }));
  }

  async crmGorevEkle(cariId: string, girdi: z.infer<typeof crmGorevSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const atananUserId = girdi.atananUserId ?? userId;
      const kullanici = await tx.user.findFirst({ where: { id: atananUserId, aktif: true } });
      if (!kullanici) throw new BadRequestException("Atanacak aktif kullanıcı bulunamadı");
      if (girdi.hatirlatmaTarihi && girdi.sonTarih && new Date(girdi.hatirlatmaTarihi) > new Date(girdi.sonTarih)) throw new BadRequestException("Hatırlatma tarihi son tarihten sonra olamaz");
      return tx.crmGorev.create({ data: { tenantId, cariId, atananUserId, baslik: girdi.baslik, aciklama: girdi.aciklama, sonTarih: girdi.sonTarih ? new Date(girdi.sonTarih) : null, hatirlatmaTarihi: girdi.hatirlatmaTarihi ? new Date(girdi.hatirlatmaTarihi) : null, oncelik: girdi.oncelik } });
    });
  }

  async crmGorevDurum(cariId: string, gorevId: string, durum: "acik" | "tamamlandi" | "iptal") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const gorev = await tx.crmGorev.findFirst({ where: { id: gorevId, cariId } });
      if (!gorev) throw new NotFoundException("CRM görevi bulunamadı");
      return tx.crmGorev.update({ where: { id: gorevId }, data: { durum, tamamlanmaZamani: durum === "tamamlandi" ? new Date() : null } });
    });
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
    const [hareketler, oncekiHareketler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
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
      baslangic ? tx.cariHareket.findMany({ where: { cariId, tarih: { lt: new Date(baslangic) } }, select: { tip: true, tutarTry: true } }) : Promise.resolve([]),
    ]));
    const devirBakiyesi = oncekiHareketler.reduce((toplam, h) => h.tip === "borc" ? toplam.add(h.tutarTry) : toplam.sub(h.tutarTry), new Prisma.Decimal(0));
    let bakiye = devirBakiyesi;
    let donemBorc = new Prisma.Decimal(0); let donemAlacak = new Prisma.Decimal(0);
    const satirlar = hareketler.map((h) => {
      if (h.tip === "borc") donemBorc = donemBorc.add(h.tutarTry); else donemAlacak = donemAlacak.add(h.tutarTry);
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
    return { cari: { id: cari.id, kod: cari.kod, unvan: cari.unvan, eposta: cari.eposta }, devirBakiyesi: devirBakiyesi.toFixed(2), donemBorc: donemBorc.toFixed(2), donemAlacak: donemAlacak.toFixed(2), donemSonuBakiyesi: bakiye.toFixed(2), satirlar };
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
        _sum: { tutar: true, tutarTry: true },
      }),
    );
    const sonuc = new Map<string, Map<string, { borc: Prisma.Decimal; alacak: Prisma.Decimal; borcTry: Prisma.Decimal; alacakTry: Prisma.Decimal }>>();
    for (const g of gruplar) {
      const cariMap = sonuc.get(g.cariId) ?? new Map();
      const kayit = cariMap.get(g.dovizCinsi) ?? {
        borc: new Prisma.Decimal(0),
        alacak: new Prisma.Decimal(0),
        borcTry: new Prisma.Decimal(0),
        alacakTry: new Prisma.Decimal(0),
      };
      if (g.tip === "borc") { kayit.borc = kayit.borc.add(g._sum.tutar ?? 0); kayit.borcTry = kayit.borcTry.add(g._sum.tutarTry ?? 0); }
      else { kayit.alacak = kayit.alacak.add(g._sum.tutar ?? 0); kayit.alacakTry = kayit.alacakTry.add(g._sum.tutarTry ?? 0); }
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
          bakiyeTry: t.borcTry.sub(t.alacakTry).toFixed(2),
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
    const hareketSatirlari = data.satirlar.map((s) => ({
      tarih: new Date(s.tarih),
      aciklama: s.aciklama || "",
      borc: s.tip === "borc" ? s.tutarTry : "",
      alacak: s.tip === "alacak" ? s.tutarTry : "",
      bakiye: s.yuruyenBakiye,
    }));
    const mapped = baslangic
      ? [{ tarih: new Date(baslangic), aciklama: "DEVİR BAKİYESİ", borc: Number(data.devirBakiyesi) > 0 ? data.devirBakiyesi : "", alacak: Number(data.devirBakiyesi) < 0 ? String(Math.abs(Number(data.devirBakiyesi))) : "", bakiye: data.devirBakiyesi }, ...hareketSatirlari]
      : hareketSatirlari;

    return cariEkstreExcelYaz(data.cari, mapped);
  }

  /** Ekstre PDF çıktısı (CARI-04, T-02 altyapısıyla). */
  async ekstrePdf(
    cariId: string,
    baslangic?: string,
    bitis?: string,
  ): Promise<Buffer> {
    const data = await this.ekstre(cariId, baslangic, bitis);
    const aralik =
      baslangic || bitis
        ? ` — dönem: ${baslangic ? tarihBicim(baslangic) : "…"} – ${bitis ? tarihBicim(bitis) : "…"}`
        : "";
    const devirSatiri = baslangic ? `<tr><td class="orta">${tarihBicim(baslangic)}</td><td><b>DEVİR BAKİYESİ</b></td><td></td><td></td><td class="sag"><b>${paraBicim(data.devirBakiyesi)}</b></td></tr>` : "";
    const satirlar = devirSatiri + data.satirlar
      .map(
        (s) => `<tr>
  <td class="orta">${tarihBicim(s.tarih)}</td>
  <td>${kacis(s.aciklama ?? "")}</td>
  <td class="sag">${s.tip === "borc" ? paraBicim(s.tutarTry) : ""}</td>
  <td class="sag">${s.tip === "alacak" ? paraBicim(s.tutarTry) : ""}</td>
  <td class="sag">${paraBicim(s.yuruyenBakiye)}</td>
</tr>`,
      )
      .join("\n");
    const sonBakiye = data.donemSonuBakiyesi;
    const icerik = `<table class="veri">
  <thead><tr>
    <th>Tarih</th><th>Açıklama</th>
    <th class="sag">Borç</th><th class="sag">Alacak</th><th class="sag">Bakiye</th>
  </tr></thead>
  <tbody>${
    satirlar ||
    `<tr><td class="orta" colspan="5">Dönemde hareket bulunamadı</td></tr>`
  }</tbody>
</table>
<p style="margin-top:10px;text-align:right;font-weight:bold">
  Dönem sonu bakiyesi: ${paraBicim(sonBakiye)} TL
</p>`;
    const logoDataUri = await this.pdf.firmaLogoDataUri();
    return this.pdf.htmlToPdf(
      sayfaSablonu({
        baslik: "CARİ HESAP EKSTRESİ",
        altBaslik: `${data.cari.kod} — ${data.cari.unvan}${aralik}`,
        icerik,
        logoDataUri,
      }),
    );
  }

  async ekstreEpostaGonder(cariId: string, baslangic?: string, bitis?: string, alici?: string) {
    const cari = await this.getir(cariId);
    const hedef = alici ?? cari.eposta;
    if (!hedef) throw new BadRequestException("Cari kartında e-posta adresi bulunmuyor");
    const [pdf, excel] = await Promise.all([this.ekstrePdf(cariId, baslangic, bitis), this.ekstreExcel(cariId, baslangic, bitis)]);
    const donem = baslangic || bitis ? `${baslangic ?? "başlangıç"} - ${bitis ?? "bugün"}` : "tüm dönem";
    await this.eposta.ekliIletiGonder({ alici: hedef, konu: `${cari.unvan} cari hesap ekstresi`, metin: `Sayın Yetkili,\n\n${donem} cari hesap ekstreniz PDF ve Excel formatında ekte sunulmuştur.\n\nSaygılarımızla`, ekler: [{ dosyaAdi: `ekstre-${cari.kod}.pdf`, icerik: pdf, mime: "application/pdf" }, { dosyaAdi: `ekstre-${cari.kod}.xlsx`, icerik: excel, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] });
    return { mesaj: `Ekstre ${hedef} adresine gönderildi` };
  }
}
