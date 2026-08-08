import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma, FaturaTip, FaturaDurum, BelgeDurum } from "@prisma/client";
import { faturaHesapla, type FaturaHesaplaSatirGirdi, type KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { StokService } from "../stok/stok.service";
import { DepoService } from "../stok/depo.service";
import { EbelgeKuyrukService } from "../ebelge/ebelge-kuyruk.service";
import { EpostaService } from "../tenant/eposta.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { faturaPdfHtml } from "./fatura-pdf";
import type {
  faturaOlusturSemasi,
  faturaGuncelleSemasi,
  faturaSeriSemasi,
} from "./fatura.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class FaturaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stokService: StokService,
    private readonly depoService: DepoService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
    private readonly belgelerService: BelgelerService,
    @Inject(forwardRef(() => EbelgeKuyrukService))
    private readonly ebelgeKuyrukService: EbelgeKuyrukService,
  ) {}

  // ─── FATURA SERİ TANIMLARI ────────────────────────────────────────────────

  async seriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.faturaSeri.findMany({ orderBy: [{ yil: "desc" }, { seri: "asc" }] }),
    );
  }

  async seriEkle(girdi: z.infer<typeof faturaSeriSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.faturaSeri.create({
          data: {
            tenantId,
            seri: girdi.seri,
            yil: girdi.yil,
            sonSira: girdi.sonSira ?? 0,
          },
        }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(
          `'${girdi.seri}' serisi ${girdi.yil} yılı için zaten tanımlı`,
        );
      }
      throw hata;
    }
  }

  // ─── FATURA CRUD İŞLEMLERİ ───────────────────────────────────────────────

  async listele(
    arama?: string,
    tip?: string,
    durum?: string,
    imlec?: string,
    adet = 50,
    yon?: string,
    ebelge?: string,
  ) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();

    const where: Prisma.FaturaWhereInput = {
      ...(tip ? { tip: tip as FaturaTip } : yon === "satis" ? { tip: { in: ["satis", "satis_iade", "proforma"] } } : yon === "alis" ? { tip: { in: ["alis", "alis_iade"] } } : {}),
      ...(durum ? { durum: durum as FaturaDurum } : {}),
      ...(ebelge ? { ebelge: { is: { durum: ebelge === "hata" ? { in: ["hata", "ret"] } : ebelge as BelgeDurum } } } : {}),
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

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        where,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          ebelge: { select: { id: true, durum: true, tur: true } },
          kasaBankaHarekets: { select: { tutar: true } },
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => {
        const odenen = k.kasaBankaHarekets.reduce(
          (toplam, hareket) => toplam.add(hareket.tutar),
          D(0),
        );
        const kalan = Prisma.Decimal.max(k.genelToplam.sub(odenen), 0);
        return {
          ...this.gorunum(k),
          cari: k.cari,
          ebelge: k.ebelge,
          odemeOzeti: {
            durum: k.durum !== "kesin" ? "beklemede" : kalan.isZero() ? "odendi" : odenen.greaterThan(0) ? "kismi" : "odenmedi",
            odenen: odenen.toFixed(2),
            kalan: kalan.toFixed(2),
          },
          izinliEylemler: this.eylemler(k, ctx.rol),
        };
      }),
      sonrakiImlec,
    };
  }

  async isKuyruguOzeti() {
    const { tenantId } = aktifBaglam();
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findMany({
        select: {
          tip: true,
          durum: true,
          genelToplam: true,
          ebelge: { select: { durum: true } },
          kasaBankaHarekets: { select: { tutar: true } },
        },
      }),
    );
    const ozet = { taslakSatis: 0, taslakAlis: 0, ebelgeHata: 0, acikTahsilat: 0, acikOdeme: 0 };
    for (const fatura of faturalar) {
      if (fatura.durum === "taslak") {
        if (["satis", "satis_iade", "proforma"].includes(fatura.tip)) ozet.taslakSatis += 1;
        if (["alis", "alis_iade"].includes(fatura.tip)) ozet.taslakAlis += 1;
      }
      if (["hata", "ret"].includes(fatura.ebelge?.durum ?? "")) ozet.ebelgeHata += 1;
      if (fatura.durum !== "kesin") continue;
      const odenen = fatura.kasaBankaHarekets.reduce((toplam, hareket) => toplam.add(hareket.tutar), D(0));
      if (odenen.greaterThanOrEqualTo(fatura.genelToplam)) continue;
      if (["satis", "alis_iade"].includes(fatura.tip)) ozet.acikTahsilat += 1;
      if (["alis", "satis_iade"].includes(fatura.tip)) ozet.acikOdeme += 1;
    }
    return ozet;
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.fatura.findUnique({
        where: { id },
        include: {
          cari: { select: { id: true, kod: true, unvan: true, vknTckn: true, eFaturaMukellefi: true } },
          satirlar: {
            include: {
              stok: { select: { id: true, kod: true, ad: true } },
            },
          },
          ebelge: true,
          kasaBankaHarekets: {
            orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
            include: {
              kasa: { select: { ad: true } },
              bankaHesap: { select: { ad: true } },
            },
          },
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Fatura bulunamadı");

    const odenen = kayit.kasaBankaHarekets.reduce(
      (toplam, hareket) => toplam.add(hareket.tutar),
      new Prisma.Decimal(0),
    );
    const kalan = Prisma.Decimal.max(kayit.genelToplam.sub(odenen), 0);

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
        iskontoTutari: s.iskontoTutari.toFixed(2),
        genelIskontoPayi: s.genelIskontoPayi.toFixed(2),
        matrah: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        kdvTutari: s.kdvTutari.toFixed(2),
        tevkifatPay: s.tevkifatPay,
        tevkifatPayda: s.tevkifatPayda,
        tevkifatTutari: s.tevkifatTutari.toFixed(2),
        netKdvTutari: s.netKdvTutari.toFixed(2),
        toplamTutar: s.toplamTutar.toFixed(2),
        gibIstisnaKodu: s.gibIstisnaKodu,
      })),
      ebelge: kayit.ebelge,
      odemeOzeti: {
        durum: kayit.durum !== "kesin" ? "beklemede" : kalan.isZero() ? "odendi" : odenen.greaterThan(0) ? "kismi" : "odenmedi",
        odenen: odenen.toFixed(2),
        kalan: kalan.toFixed(2),
        hareketler: kayit.kasaBankaHarekets.map((hareket) => ({
          id: hareket.id,
          tip: hareket.tip,
          tutar: hareket.tutar.toFixed(2),
          dovizCinsi: hareket.dovizCinsi,
          tarih: hareket.tarih.toISOString().slice(0, 10),
          aciklama: hareket.aciklama,
          hesap: hareket.kasa?.ad ?? hareket.bankaHesap?.ad ?? "Hesap belirtilmedi",
          createdAt: hareket.createdAt.toISOString(),
        })),
      },
      izinliEylemler: this.eylemler(kayit, ctx.rol),
    };
  }

  async olustur(girdi: z.infer<typeof faturaOlusturSemasi>) {
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

    // Fatura hesaplamalarını shared engine üzerinden yapalım (FTR-04)
    const hesaplanan = this.hesaplaFatura(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Fatura kafasını oluştur
      const fatura = await tx.fatura.create({
        data: {
          tenantId,
          tip: girdi.tip,
          durum: "taslak",
          tarih: new Date(girdi.tarih),
          vadeTarihi: girdi.vadeTarihi ? new Date(girdi.vadeTarihi) : null,
          cariId: girdi.cariId,
          // STK-07: boş bırakılırsa depo kesinleştirmede varsayılana çözülür
          depoId: girdi.depoId ?? null,
          dovizCinsi: girdi.dovizCinsi,
          kur: D(girdi.kur),
          genelIskontoYuzdesi: D(girdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(girdi.genelIskontoTutari),
          toplamBrut: D(hesaplanan.toplamBrut),
          toplamSatirIskontosu: D(hesaplanan.toplamSatirIskontosu),
          genelIskontoToplam: D(hesaplanan.genelIskontoTutari),
          toplamMatrah: D(hesaplanan.toplamMatrah),
          toplamKdv: D(hesaplanan.toplamKdv),
          toplamTevkifat: D(hesaplanan.toplamTevkifat),
          toplamNetKdv: D(hesaplanan.toplamNetKdv),
          genelToplam: D(hesaplanan.genelToplam),
          aciklama: girdi.aciklama,
          notlar: girdi.notlar,
        },
      });

      // Satırları oluştur (sıralı await: async forEach transaction
      // kapandıktan sonra çalışıp P2028 ile süreci düşürüyordu)
      for (const [index, s] of hesaplanan.satirlar.entries()) {
        const orijinalSatir = girdi.satirlar[index];
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: fatura.id,
            stokId: s.stokId,
            miktar: D(s.miktar),
            birim: orijinalSatir.birim ?? "adet",
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
            gibIstisnaKodu: orijinalSatir.gibIstisnaKodu,
          },
        });
      }

      return this.gorunum(fatura);
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof faturaGuncelleSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const fatura = await this.getir(id);

    if (fatura.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak faturalar güncellenebilir");
    }

    // Tam güncelleme için girdiyi tamamla
    const birlesikGirdi = {
      tip: girdi.tip ?? (fatura.tip as z.infer<typeof faturaOlusturSemasi>["tip"]),
      tarih: girdi.tarih ?? fatura.tarih,
      vadeTarihi: girdi.vadeTarihi !== undefined ? girdi.vadeTarihi : fatura.vadeTarihi,
      cariId: girdi.cariId ?? fatura.cariId,
      depoId: girdi.depoId !== undefined ? girdi.depoId : fatura.depoId,
      dovizCinsi: girdi.dovizCinsi ?? (fatura.dovizCinsi as "TRY" | "USD" | "EUR"),
      kur: girdi.kur ?? fatura.kur,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ?? fatura.genelIskontoYuzdesi,
      genelIskontoTutari: girdi.genelIskontoTutari ?? fatura.genelIskontoTutari,
      aciklama: girdi.aciklama !== undefined ? girdi.aciklama : fatura.aciklama,
      notlar: girdi.notlar !== undefined ? girdi.notlar : fatura.notlar,
      satirlar:
        girdi.satirlar ??
        fatura.satirlar.map((s) => ({
          stokId: s.stokId,
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          kdvOrani: s.kdvOrani,
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          gibIstisnaKodu: s.gibIstisnaKodu,
        })),
    };

    // FTR-14: satıcı kullanıcı bazında maksimum iskonto yetkisi kontrolü
    const user = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (user && user.maksIskontoYuzdesi !== null) {
      const maks = Number(user.maksIskontoYuzdesi);
      if (Number(birlesikGirdi.genelIskontoYuzdesi ?? 0) > maks) {
        throw new BadRequestException(
          `Maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
        );
      }
      for (const [index, s] of birlesikGirdi.satirlar.entries()) {
        if (Number(s.iskontoOrani ?? 0) > maks) {
          throw new BadRequestException(
            `Satır ${index + 1} için maksimum iskonto yetkiniz (%${maks}) aşılmıştır.`
          );
        }
      }
    }

    const hesaplanan = this.hesaplaFatura(birlesikGirdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Satırları sil ve yeniden ekle
      await tx.faturaSatir.deleteMany({ where: { faturaId: id } });

      // Sıralı await (async forEach P2028 hatası — olustur ile aynı düzeltme)
      for (const [index, s] of hesaplanan.satirlar.entries()) {
        const orijinalSatir = birlesikGirdi.satirlar[index];
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: id,
            stokId: s.stokId,
            miktar: D(s.miktar),
            birim: orijinalSatir.birim ?? "adet",
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
            gibIstisnaKodu: orijinalSatir.gibIstisnaKodu,
          },
        });
      }

      const guncellenen = await tx.fatura.update({
        where: { id },
        data: {
          tip: birlesikGirdi.tip,
          tarih: new Date(birlesikGirdi.tarih),
          vadeTarihi: birlesikGirdi.vadeTarihi ? new Date(birlesikGirdi.vadeTarihi) : null,
          cariId: birlesikGirdi.cariId,
          depoId: birlesikGirdi.depoId ?? null,
          dovizCinsi: birlesikGirdi.dovizCinsi,
          kur: D(birlesikGirdi.kur),
          genelIskontoYuzdesi: D(birlesikGirdi.genelIskontoYuzdesi),
          genelIskontoTutari: D(birlesikGirdi.genelIskontoTutari),
          toplamBrut: D(hesaplanan.toplamBrut),
          toplamSatirIskontosu: D(hesaplanan.toplamSatirIskontosu),
          genelIskontoToplam: D(hesaplanan.genelIskontoTutari),
          toplamMatrah: D(hesaplanan.toplamMatrah),
          toplamKdv: D(hesaplanan.toplamKdv),
          toplamTevkifat: D(hesaplanan.toplamTevkifat),
          toplamNetKdv: D(hesaplanan.toplamNetKdv),
          genelToplam: D(hesaplanan.genelToplam),
          aciklama: birlesikGirdi.aciklama,
          notlar: birlesikGirdi.notlar,
        },
      });

      return this.gorunum(guncellenen);
    });
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const fatura = await this.getir(id);

    if (fatura.durum !== "taslak") {
      throw new BadRequestException("Yalnızca taslak faturalar silinebilir");
    }

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      // FTR-12: taslak zincir faturası siliniyorsa bağlı belgeler yeniden
      // dönüştürülebilir olsun diye onaylı durumuna döner (rezerv zaten
      // fatura kesinleşmediği için çözülmemişti).
      await tx.belge.updateMany({
        where: { faturaId: id },
        data: { faturaId: null, durum: "onaylandi" },
      });
      await tx.fatura.delete({ where: { id } });
    });
  }

  /** FTR-09: proforma faturayı tek tıkla satış faturası taslağına dönüştürür. */
  async satisaDonustur(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const proforma = await tx.fatura.findUnique({
        where: { id },
        include: { satirlar: true },
      });
      if (!proforma) throw new NotFoundException("Fatura bulunamadı");
      if (proforma.tip !== "proforma") {
        throw new BadRequestException("Yalnızca proforma faturalar dönüştürülebilir");
      }

      const yeni = await tx.fatura.create({
        data: {
          tenantId,
          tip: "satis",
          durum: "taslak",
          tarih: new Date(),
          vadeTarihi: proforma.vadeTarihi,
          cariId: proforma.cariId,
          dovizCinsi: proforma.dovizCinsi,
          kur: proforma.kur,
          genelIskontoYuzdesi: proforma.genelIskontoYuzdesi,
          genelIskontoTutari: proforma.genelIskontoTutari,
          toplamBrut: proforma.toplamBrut,
          toplamSatirIskontosu: proforma.toplamSatirIskontosu,
          genelIskontoToplam: proforma.genelIskontoToplam,
          toplamMatrah: proforma.toplamMatrah,
          toplamKdv: proforma.toplamKdv,
          toplamTevkifat: proforma.toplamTevkifat,
          toplamNetKdv: proforma.toplamNetKdv,
          genelToplam: proforma.genelToplam,
          aciklama: `${proforma.no ?? "Proforma"} kaynaklı satış faturası`,
          notlar: proforma.notlar,
        },
      });
      for (const s of proforma.satirlar) {
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: yeni.id,
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
      return this.gorunum(yeni);
    });
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    const fatura = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.findUnique({
        where: { id },
        include: {
          satirlar: true,
        },
      }),
    );

    if (!fatura) throw new NotFoundException("Fatura bulunamadı");

    const ctx = aktifBaglam();
    if (!eylemIzinli("fatura", "kopyala", { durum: fatura.durum }, ctx)) {
      throw new ForbiddenException("Bu fatura kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    const yeni = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.fatura.create({
        data: {
          tenantId,
          tip: fatura.tip,
          durum: "taslak",
          tarih: new Date(),
          vadeTarihi: null,
          cariId: fatura.cariId,
          dovizCinsi: fatura.dovizCinsi,
          kur: fatura.kur,
          genelIskontoYuzdesi: fatura.genelIskontoYuzdesi,
          genelIskontoTutari: fatura.genelIskontoTutari,
          toplamBrut: fatura.toplamBrut,
          toplamSatirIskontosu: fatura.toplamSatirIskontosu,
          genelIskontoToplam: fatura.genelIskontoToplam,
          toplamMatrah: fatura.toplamMatrah,
          toplamKdv: fatura.toplamKdv,
          toplamTevkifat: fatura.toplamTevkifat,
          toplamNetKdv: fatura.toplamNetKdv,
          genelToplam: fatura.genelToplam,
          aciklama: fatura.aciklama ? `${fatura.aciklama} (Kopya)` : "Kopya",
          notlar: fatura.notlar,
        },
      });

      for (const s of fatura.satirlar) {
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: kopya.id,
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
            gibIstisnaKodu: s.gibIstisnaKodu,
          },
        });
      }

      return kopya;
    });

    return this.getir(yeni.id);
  }

  // ─── FATURA KESİNLEŞTİRME VE ENTEGRASYONLAR (FTR-03/05/06) ───────────────

  async kesinlestir(id: string, veri?: { no?: string; seri?: string }) {
    const { tenantId } = aktifBaglam();
    
    // Faturayı kilitlemek ve işlemleri yürütmek için transaction başlatıyoruz
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id },
        include: { satirlar: true, cari: true },
      });

      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "taslak") {
        throw new BadRequestException("Fatura zaten kesinleştirilmiş veya iptal edilmiş");
      }

      // İşlem blokajı (CARI-17): kara listedeki cariye belge kesilemez.
      if (fatura.cari.karaListe) {
        throw new BadRequestException(
          `'${fatura.cari.unvan}' işlem blokajında (kara liste); fatura kesinleştirilemez` +
            (fatura.cari.karaListeNotu ? ` — ${fatura.cari.karaListeNotu}` : ""),
        );
      }

      let seriKod = veri?.seri ?? "TKR";
      let faturaNo = veri?.no ?? null;

      // 1. Numara Serisi Üretimi (FTR-06):
      // Alış faturalarında numara el ile girilir, satış faturalarında sayaç artırılarak otomatik üretilir.
      if (fatura.tip === "satis" || fatura.tip === "satis_iade") {
        const yil = new Date(fatura.tarih).getFullYear();
        
        // FaturaSeri kaydını kilitleyerek güncelliyoruz (Concurrency Safe)
        let seriKaydi = await tx.faturaSeri.findUnique({
          where: { tenantId_seri_yil: { tenantId, seri: seriKod, yil } },
        });

        if (!seriKaydi) {
          seriKaydi = await tx.faturaSeri.create({
            data: { tenantId, seri: seriKod, yil, sonSira: 0 },
          });
        }

        const guncelSeri = await tx.faturaSeri.update({
          where: { id: seriKaydi.id },
          data: { sonSira: { increment: 1 } },
        });

        faturaNo = `${seriKod}${yil}${String(guncelSeri.sonSira).padStart(9, "0")}`;
        fatura.seri = seriKod;
        fatura.sira = guncelSeri.sonSira;
      } else {
        // Alış faturası ise el ile girilen numara zorunlu olmalı
        if (!faturaNo) {
          throw new BadRequestException("Alış faturaları için belge numarası girmelisiniz");
        }
      }

      // 1b. Belge zinciri çözümü (FTR-12): zincirden gelen faturada bağlı
      // belgeler ve kaynakları yürünür; siparişlerin rezervi (satış) veya
      // yoldakisi (alış) çözülür. Stok hareketlerinden ÖNCE yapılır ki
      // kullanılabilir stok kontrolü (STK-17) rezervi çifte saymasın.
      const bagliBelgeler = await tx.belge.findMany({
        where: { faturaId: id },
        select: {
          id: true,
          tur: true,
          yon: true,
          depoId: true,
          kaynakBelgeId: true,
          satirlar: { select: { stokId: true, miktar: true } },
        },
      });
      const gorulen = new Set<string>();
      const kuyruk = [...bagliBelgeler];
      while (kuyruk.length > 0) {
        const b = kuyruk.pop();
        if (!b || gorulen.has(b.id)) continue;
        gorulen.add(b.id);
        if (b.tur === "siparis") {
          // Rezerv, siparişin kendi deposundan çözülür (STK-07)
          await this.belgelerService.siparisEtkisiUygula(
            tx,
            b.yon,
            b.satirlar,
            -1,
            b.depoId,
          );
        }
        if (b.kaynakBelgeId && !gorulen.has(b.kaynakBelgeId)) {
          const kaynak = await tx.belge.findUnique({
            where: { id: b.kaynakBelgeId },
            select: {
              id: true,
              tur: true,
              yon: true,
              depoId: true,
              kaynakBelgeId: true,
              satirlar: { select: { stokId: true, miktar: true } },
            },
          });
          if (kaynak) kuyruk.push(kaynak);
        }
      }

      // 2. Stok Hareketlerinin Tetiklenmesi (FTR-03):
      // Satış/Alış_İade -> Çıkış hareketi (Stok azalır).
      // Alış/Satış_İade -> Giriş hareketi (Stok artar).
      // Proforma fatura stoğu etkilemez.
      const stokUyarilari: string[] = [];
      // Kesinleşen faturada hangi depodan çıkıldığı kayda geçer (STK-07)
      let kullanilanDepoId: string | null = fatura.depoId;
      if (fatura.tip !== "proforma") {
        // STK-07: fatura başlığındaki depo; seçilmemişse varsayılan depo
        const depoId = await this.depoService.depoCozumle(tx, fatura.depoId);
        kullanilanDepoId = depoId;
        for (const s of fatura.satirlar) {
          const tip =
            fatura.tip === "satis" || fatura.tip === "alis_iade" ? "cikis" : "giris";

          const hareketSonucu = await this.stokService.hareketEkle(tx, {
            stokId: s.stokId,
            depoId,
            tip,
            miktar: s.miktar,
            girilenBirim: s.birim,
            girilenMiktar: s.miktar,
            birimMaliyet: s.birimFiyat,
            tarih: new Date(fatura.tarih),
            aciklama: `${faturaNo || fatura.id} nolu fatura hareketi`,
            kaynakTur: "fatura",
            kaynakRef: fatura.id,
          });
          // Eksi stok politikası "uyar" ise kesinleştirme sürer, uyarı döner (STK-17)
          if (hareketSonucu.eksiStokUyarisi) {
            stokUyarilari.push(hareketSonucu.eksiStokUyarisi);
          }
        }

        // 3. Cari Hesap Hareketinin Tetiklenmesi (FTR-03):
        // Satış/Alış_İade -> Borç.
        // Alış/Satış_İade -> Alacak.
        const cariHareketTip =
          fatura.tip === "satis" || fatura.tip === "alis_iade" ? "borc" : "alacak";

        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: fatura.cariId,
            tip: cariHareketTip,
            tutar: fatura.genelToplam,
            dovizCinsi: fatura.dovizCinsi,
            kur: fatura.kur,
            tutarTry: fatura.genelToplam.mul(fatura.kur).toDecimalPlaces(2),
            tarih: new Date(fatura.tarih),
            vadeTarihi: fatura.vadeTarihi ? new Date(fatura.vadeTarihi) : null,
            aciklama: `${faturaNo || "Fatura"} nolu fatura hareketi`,
            kaynakTur: "fatura",
            kaynakRef: fatura.id,
          },
        });
      }

      // Risk limiti kontrolü (CARI-08): kesinleştirmeyi engellemez, uyarı döner.
      let riskUyari: string | null = null;
      if (fatura.tip === "satis" && fatura.cari.riskLimiti !== null) {
        const gruplar = await tx.cariHareket.groupBy({
          by: ["tip"],
          where: { cariId: fatura.cariId },
          _sum: { tutarTry: true },
        });
        let bakiye = new Prisma.Decimal(0);
        for (const g of gruplar) {
          const t = g._sum.tutarTry ?? new Prisma.Decimal(0);
          bakiye = g.tip === "borc" ? bakiye.add(t) : bakiye.sub(t);
        }
        if (bakiye.greaterThan(fatura.cari.riskLimiti)) {
          riskUyari = `Risk limiti aşıldı: bakiye ${bakiye.toFixed(2)} TL, limit ${fatura.cari.riskLimiti.toFixed(2)} TL`;
        }
      }

      // 4. e-Belge Gönderim Tetikleyicisi
      let ebelgeGerekli = false;
      if (fatura.tip === "satis" || fatura.tip === "satis_iade") {
        ebelgeGerekli = true;
        const tur = fatura.cari.eFaturaMukellefi ? "efatura" : "earsiv";

        await tx.ebelgeKayit.create({
          data: {
            tenantId,
            faturaId: fatura.id,
            tur,
            durum: "kuyrukta",
          },
        });
      }

      // Fatura durumunu güncelle
      const kesinFatura = await tx.fatura.update({
        where: { id },
        data: {
          durum: "kesin",
          no: faturaNo,
          seri: fatura.seri,
          sira: fatura.sira,
          depoId: kullanilanDepoId,
        },
      });

      return {
        kesinFatura: { ...this.gorunum(kesinFatura), riskUyari, stokUyarilari },
        ebelgeGerekli,
      };
    });

    if (sonuc.ebelgeGerekli) {
      this.ebelgeKuyrukService.kuyrugaEkle(id);
    }

    return sonuc.kesinFatura;
  }

  // ─── PDF ÜRETİMİ (FTR-07, T-02 altyapısı) ───────────────────────────────

  async pdfUret(id: string): Promise<{ buffer: Buffer; dosyaAdi: string }> {
    const fatura = await this.getir(id);
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
      faturaPdfHtml(fatura, { ...firma, logoDataUri }),
    );
    return {
      buffer,
      dosyaAdi: `fatura-${fatura.no ?? "taslak"}.pdf`,
    };
  }

  /**
   * Fatura PDF'ini cariye e-posta ile gönderir (FTR-07). Alıcı verilmezse
   * cari kartındaki e-posta kullanılır; taslak fatura gönderilemez.
   */
  async pdfGonder(id: string, aliciEposta?: string) {
    const fatura = await this.getir(id);
    if (fatura.durum === "taslak") {
      throw new BadRequestException(
        "Taslak fatura gönderilemez; önce kesinleştirin",
      );
    }
    let alici = aliciEposta;
    if (!alici) {
      const { tenantId } = aktifBaglam();
      const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findUnique({
          where: { id: fatura.cariId },
          select: { eposta: true },
        }),
      );
      alici = cari?.eposta ?? undefined;
    }
    if (!alici) {
      throw new BadRequestException(
        "Alıcı e-postası yok: cari kartına e-posta ekleyin veya adres belirtin",
      );
    }
    const { buffer, dosyaAdi } = await this.pdfUret(id);
    await this.eposta.ekliIletiGonder({
      alici,
      konu: `Fatura ${fatura.no}`,
      metin: `Sayın ${fatura.cari.unvan},\n\n${fatura.no} numaralı faturanız ekte yer almaktadır.\n\nİyi çalışmalar dileriz.`,
      ekler: [{ dosyaAdi, icerik: buffer, mime: "application/pdf" }],
    });
    return { gonderildi: true, alici };
  }

  // ─── PRIVATE YARDIMCILAR ──────────────────────────────────────────────────

  private hesaplaFatura(girdi: {
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
    const satirGirdileri: FaturaHesaplaSatirGirdi[] = girdi.satirlar.map((s) => ({
      stokId: s.stokId,
      miktar: Number(s.miktar),
      birimFiyat: Number(s.birimFiyat),
      iskontoOrani: Number(s.iskontoOrani),
      kdvOrani: Number(s.kdvOrani),
      tevkifatPay: s.tevkifatPay || undefined,
      tevkifatPayda: s.tevkifatPayda || undefined,
    }));

    return faturaHesapla({
      satirlar: satirGirdileri,
      genelIskontoYuzdesi: girdi.genelIskontoYuzdesi ? Number(girdi.genelIskontoYuzdesi) : 0,
      genelIskontoTutari: girdi.genelIskontoTutari ? Number(girdi.genelIskontoTutari) : 0,
    });
  }

  private eylemler(kayit: { durum: string }, _rol: string): KayitEylem[] {
    return izinliEylemler("fatura", { durum: kayit.durum }, aktifBaglam());
  }

  private gorunum(k: {
    id: string;
    tip: string;
    durum: string;
    no: string | null;
    seri: string | null;
    sira: number | null;
    tarih: Date;
    vadeTarihi: Date | null;
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
  }) {
    return {
      id: k.id,
      tip: k.tip,
      durum: k.durum,
      no: k.no,
      seri: k.seri,
      sira: k.sira,
      tarih: k.tarih.toISOString().slice(0, 10),
      vadeTarihi: k.vadeTarihi?.toISOString().slice(0, 10) ?? null,
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
    };
  }
}
