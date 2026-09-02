import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { EpostaService } from "../tenant/eposta.service";
import { BelgelerService } from "../belgeler/belgeler.service";
import { faturaPdfHtml } from "./fatura-pdf";
import type {
  faturaOlusturSemasi,
  faturaGuncelleSemasi,
  faturaSeriSemasi,
  tekrarlayanFaturaGuncelleSemasi,
  tekrarlayanFaturaSemasi,
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
  ) {}

  private async cariTipiniDogrula(tx: Prisma.TransactionClient, cariId: string, tip: string): Promise<void> {
    const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { tip: true } });
    if (!cari) throw new NotFoundException("Cari hesap bulunamadı");
    const alisYonlu = tip === "alis" || tip === "alis_iade";
    const uygun = alisYonlu
      ? cari.tip === "tedarikci" || cari.tip === "her_ikisi"
      : cari.tip === "musteri" || cari.tip === "her_ikisi";
    if (!uygun) {
      throw new BadRequestException(alisYonlu
        ? "Alış faturasında tedarikçi veya her iki tipindeki cari seçilmelidir"
        : "Satış faturasında müşteri veya her iki tipindeki cari seçilmelidir");
    }
  }

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

  // ─── TEKRARLAYAN FATURALAR (FTR-10) ─────────────────────────────

  async tekrarlayanListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.tekrarlayanFatura.findMany({
      orderBy: [{ aktif: "desc" }, { sonrakiTarih: "asc" }],
      include: {
        sablonFatura: { select: { id: true, no: true, tip: true, dovizCinsi: true, genelToplam: true, cari: { select: { unvan: true } } } },
        _count: { select: { uretilenler: true } },
      },
    }));
  }

  async tekrarlayanOlustur(girdi: z.infer<typeof tekrarlayanFaturaSemasi>) {
    const { tenantId } = aktifBaglam();
    if (girdi.bitisTarihi && girdi.bitisTarihi < girdi.sonrakiTarih) {
      throw new BadRequestException("Bitiş tarihi ilk üretim tarihinden önce olamaz");
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sablon = await tx.fatura.findUnique({ where: { id: girdi.sablonFaturaId } });
      if (!sablon) throw new NotFoundException("Şablon fatura bulunamadı");
      return tx.tekrarlayanFatura.create({ data: {
        tenantId, ad: girdi.ad, sablonFaturaId: girdi.sablonFaturaId,
        siklik: girdi.siklik, aralik: girdi.aralik,
        sonrakiTarih: new Date(girdi.sonrakiTarih),
        bitisTarihi: girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : null,
      }});
    });
  }

  async tekrarlayanGuncelle(id: string, girdi: z.infer<typeof tekrarlayanFaturaGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const plan = await tx.tekrarlayanFatura.findUnique({ where: { id } });
      if (!plan) throw new NotFoundException("Tekrarlayan fatura planı bulunamadı");
      const sonraki = girdi.sonrakiTarih ? new Date(girdi.sonrakiTarih) : plan.sonrakiTarih;
      const bitis = girdi.bitisTarihi === undefined ? plan.bitisTarihi : girdi.bitisTarihi ? new Date(girdi.bitisTarihi) : null;
      if (bitis && bitis < sonraki) throw new BadRequestException("Bitiş tarihi sıradaki tarihten önce olamaz");
      return tx.tekrarlayanFatura.update({ where: { id }, data: {
        ad: girdi.ad, aktif: girdi.aktif, sonrakiTarih: sonraki, bitisTarihi: bitis,
      }});
    });
  }

  async vadesiGelenleriUret() {
    const { tenantId } = aktifBaglam();
    const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Manuel tetikleme ve zamanlanmış görev aynı anda çalışabilir. Tenant
      // bazlı transaction kilidi, "kontrol et → oluştur" aralığını sıralar;
      // ikinci çağrı ilk transaction'ın ilerlettiği sonraki tarihi görür.
      await tx.$queryRaw(Prisma.sql`
        SELECT 1 AS kilit
        FROM pg_advisory_xact_lock(
          hashtext(CAST(${tenantId} AS text)),
          hashtext('tekrarlayan_fatura_uret')
        )
      `);
      const planlar = await tx.tekrarlayanFatura.findMany({
        where: { aktif: true, sonrakiTarih: { lte: bugun } },
        include: { sablonFatura: { include: { satirlar: true } } },
      });
      const uretilenIds: string[] = [];
      for (const plan of planlar) {
        let planUretimAdedi = 0;
        let sonUretimTarihi = plan.sonUretimTarihi;
        let tarih = plan.sonrakiTarih;
        let sayac = 0;
        while (tarih <= bugun && (!plan.bitisTarihi || tarih <= plan.bitisTarihi) && sayac++ < 120) {
          const mevcut = await tx.fatura.findFirst({ where: { tekrarlayanPlanId: plan.id, planlananTarih: tarih } });
          if (!mevcut) {
            const s = plan.sablonFatura;
            const vadeGun = s.vadeTarihi
              ? Math.round((s.vadeTarihi.getTime() - s.tarih.getTime()) / 86_400_000)
              : null;
            const vadeTarihi = vadeGun === null ? null : new Date(tarih.getTime() + vadeGun * 86_400_000);
            const yeni = await tx.fatura.create({ data: {
              tenantId, tip: s.tip, durum: "taslak", tarih, vadeTarihi,
              cariId: s.cariId, depoId: s.depoId, dovizCinsi: s.dovizCinsi, kur: s.kur,
              genelIskontoYuzdesi: s.genelIskontoYuzdesi, genelIskontoTutari: s.genelIskontoTutari,
              toplamBrut: s.toplamBrut, toplamSatirIskontosu: s.toplamSatirIskontosu,
              genelIskontoToplam: s.genelIskontoToplam, toplamMatrah: s.toplamMatrah,
              toplamKdv: s.toplamKdv, toplamTevkifat: s.toplamTevkifat,
              toplamNetKdv: s.toplamNetKdv, genelToplam: s.genelToplam,
              aciklama: s.aciklama, notlar: s.notlar, tekrarlayanPlanId: plan.id, planlananTarih: tarih,
            }});
            for (const satir of s.satirlar) {
              const { id: _id, faturaId: _faturaId, ...veri } = satir;
              await tx.faturaSatir.create({ data: { ...veri, partiBilgileri: veri.partiBilgileri === null ? Prisma.JsonNull : veri.partiBilgileri as Prisma.InputJsonValue, id: undefined, faturaId: yeni.id } });
            }
            uretilenIds.push(yeni.id);
            planUretimAdedi += 1;
            sonUretimTarihi = tarih;
          }
          tarih = this.sonrakiTekrarTarihi(tarih, plan.siklik, plan.aralik);
        }
        await tx.tekrarlayanFatura.update({ where: { id: plan.id }, data: {
          sonrakiTarih: tarih, sonUretimTarihi: planUretimAdedi ? sonUretimTarihi : plan.sonUretimTarihi,
          aktif: plan.bitisTarihi ? tarih <= plan.bitisTarihi : true,
        }});
      }
      return { uretilenAdet: uretilenIds.length, faturaIds: uretilenIds };
    });
  }

  private sonrakiTekrarTarihi(tarih: Date, siklik: "haftalik" | "aylik" | "yillik", aralik: number) {
    const sonuc = new Date(tarih);
    if (siklik === "haftalik") sonuc.setUTCDate(sonuc.getUTCDate() + 7 * aralik);
    else if (siklik === "aylik") {
      const gun = sonuc.getUTCDate();
      sonuc.setUTCDate(1);
      sonuc.setUTCMonth(sonuc.getUTCMonth() + aralik);
      const sonGun = new Date(Date.UTC(sonuc.getUTCFullYear(), sonuc.getUTCMonth() + 1, 0)).getUTCDate();
      sonuc.setUTCDate(Math.min(gun, sonGun));
    } else {
      const ay = sonuc.getUTCMonth();
      sonuc.setUTCFullYear(sonuc.getUTCFullYear() + aralik, ay, 1);
      const sonGun = new Date(Date.UTC(sonuc.getUTCFullYear(), ay + 1, 0)).getUTCDate();
      sonuc.setUTCDate(Math.min(tarih.getUTCDate(), sonGun));
    }
    return sonuc;
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
    cariId?: string,
    baslangic?: string,
    bitis?: string,
  ) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();

    const tarihKosulu: Prisma.DateTimeFilter | undefined = (baslangic || bitis) ? {
      ...(baslangic ? { gte: new Date(`${baslangic}T00:00:00.000Z`) } : {}),
      ...(bitis ? { lte: new Date(`${bitis}T23:59:59.999Z`) } : {}),
    } : undefined;

    const where: Prisma.FaturaWhereInput = {
      ...(cariId ? { cariId } : {}),
      ...(tarihKosulu ? { tarih: tarihKosulu } : {}),
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
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: {
          cari: { select: { id: true, kod: true, unvan: true } },
          ebelge: { select: { id: true, durum: true, tur: true } },
          kasaBankaHarekets: { select: { tutarTry: true } },
          krediKartiHareketleri: { select: { cariOdemeTutari: true } },
          satirlar: {
            include: {
              stok: { select: { id: true, kod: true, ad: true } },
              proje: { select: { id: true, kod: true, ad: true } },
              projeAltKirilim: { select: { id: true, kod: true, ad: true } },
            },
          },
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => {
        const odenen = k.kasaBankaHarekets.reduce(
          (toplam, hareket) => toplam.add(hareket.tutarTry.div(k.kur)),
          D(0),
        ).add(k.krediKartiHareketleri.reduce((toplam, hareket) => toplam.add(hareket.cariOdemeTutari ?? 0), D(0)));
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
          kur: true,
          ebelge: { select: { durum: true } },
          kasaBankaHarekets: { select: { tutarTry: true } },
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
      const odenenTry = fatura.kasaBankaHarekets.reduce((toplam, hareket) => toplam.add(hareket.tutarTry), D(0));
      if (odenenTry.greaterThanOrEqualTo(fatura.genelToplam.mul(fatura.kur))) continue;
      if (["satis", "alis_iade"].includes(fatura.tip)) ozet.acikTahsilat += 1;
      if (["alis", "satis_iade"].includes(fatura.tip)) ozet.acikOdeme += 1;
    }
    return ozet;
  }

  async satisOzeti() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const buAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
    const oncekiAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const yilBaslangic = new Date(simdi.getFullYear(), 0, 1);
    const [donemFaturalari, acikFaturalar] = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([
      tx.fatura.findMany({
        where: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih: { gte: oncekiAyBaslangic } },
        select: { tip: true, tarih: true, genelToplam: true, toplamNetKdv: true, kur: true },
      }),
      tx.fatura.findMany({
        where: { durum: "kesin", tip: "satis" },
        select: { genelToplam: true, kur: true, kasaBankaHarekets: { select: { tutarTry: true } } },
      }),
    ]));

    let buAyToplam = D(0); let buAyKdv = D(0); let buAyAdet = 0; let oncekiAyToplam = D(0);
    for (const fatura of donemFaturalari) {
      const isaret = fatura.tip === "satis_iade" ? D(-1) : D(1);
      const toplamTry = fatura.genelToplam.mul(fatura.kur).mul(isaret);
      if (fatura.tarih >= buAyBaslangic) {
        buAyToplam = buAyToplam.add(toplamTry);
        buAyKdv = buAyKdv.add(fatura.toplamNetKdv.mul(fatura.kur).mul(isaret));
        if (fatura.tip === "satis") buAyAdet += 1;
      } else {
        oncekiAyToplam = oncekiAyToplam.add(toplamTry);
      }
    }

    const yilFaturalari = await this.prisma.tenantIslem(tenantId, (tx) => tx.fatura.findMany({
      where: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih: { gte: yilBaslangic } },
      select: { tip: true, genelToplam: true, kur: true },
    }));
    const yillikToplam = yilFaturalari.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur).mul(fatura.tip === "satis_iade" ? -1 : 1)), D(0));
    const acikTahsilat = acikFaturalar.reduce((toplam, fatura) => {
      const odenenTry = fatura.kasaBankaHarekets.reduce((ara, hareket) => ara.add(hareket.tutarTry), D(0));
      return toplam.add(Prisma.Decimal.max(fatura.genelToplam.mul(fatura.kur).sub(odenenTry), 0));
    }, D(0));
    const degisimYuzdesi = oncekiAyToplam.isZero() ? null : buAyToplam.sub(oncekiAyToplam).div(oncekiAyToplam.abs()).mul(100).toDecimalPlaces(1).toNumber();

    return { buAyToplam: buAyToplam.toFixed(2), buAyAdet, buAyKdv: buAyKdv.toFixed(2), yillikToplam: yillikToplam.toFixed(2), acikTahsilat: acikTahsilat.toFixed(2), oncekiAyaGoreDegisim: degisimYuzdesi };
  }

  async alisOzeti() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const buAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
    const oncekiAyBaslangic = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const yilBaslangic = new Date(simdi.getFullYear(), 0, 1);
    const [donemFaturalari, yilFaturalari, acikFaturalar] = await this.prisma.tenantIslem(tenantId, async (tx) => Promise.all([
      tx.fatura.findMany({ where: { durum: "kesin", tip: { in: ["alis", "alis_iade"] }, tarih: { gte: oncekiAyBaslangic } }, select: { tip: true, tarih: true, genelToplam: true, toplamNetKdv: true, kur: true } }),
      tx.fatura.findMany({ where: { durum: "kesin", tip: { in: ["alis", "alis_iade"] }, tarih: { gte: yilBaslangic } }, select: { tip: true, genelToplam: true, kur: true } }),
      tx.fatura.findMany({ where: { durum: "kesin", tip: "alis" }, select: { genelToplam: true, kur: true, kasaBankaHarekets: { select: { tutarTry: true } } } }),
    ]));

    let buAyToplam = D(0); let buAyKdv = D(0); let buAyAdet = 0; let oncekiAyToplam = D(0);
    for (const fatura of donemFaturalari) {
      const isaret = fatura.tip === "alis_iade" ? D(-1) : D(1);
      const toplamTry = fatura.genelToplam.mul(fatura.kur).mul(isaret);
      if (fatura.tarih >= buAyBaslangic) {
        buAyToplam = buAyToplam.add(toplamTry);
        buAyKdv = buAyKdv.add(fatura.toplamNetKdv.mul(fatura.kur).mul(isaret));
        if (fatura.tip === "alis") buAyAdet += 1;
      } else oncekiAyToplam = oncekiAyToplam.add(toplamTry);
    }
    const yillikToplam = yilFaturalari.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur).mul(fatura.tip === "alis_iade" ? -1 : 1)), D(0));
    const acikOdeme = acikFaturalar.reduce((toplam, fatura) => {
      const odenenTry = fatura.kasaBankaHarekets.reduce((ara, hareket) => ara.add(hareket.tutarTry), D(0));
      return toplam.add(Prisma.Decimal.max(fatura.genelToplam.mul(fatura.kur).sub(odenenTry), 0));
    }, D(0));
    const degisimYuzdesi = oncekiAyToplam.isZero() ? null : buAyToplam.sub(oncekiAyToplam).div(oncekiAyToplam.abs()).mul(100).toDecimalPlaces(1).toNumber();
    return { buAyToplam: buAyToplam.toFixed(2), buAyAdet, buAyKdv: buAyKdv.toFixed(2), yillikToplam: yillikToplam.toFixed(2), acikOdeme: acikOdeme.toFixed(2), oncekiAyaGoreDegisim: degisimYuzdesi };
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
              varyant: { select: { id: true, kod: true, ad: true, nitelikler: true } },
              proje: { select: { id: true, kod: true, ad: true } },
              projeAltKirilim: { select: { id: true, kod: true, ad: true } },
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
          krediKartiHareketleri: {
            orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
            include: { krediKarti: { select: { ad: true } } },
          },
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Fatura bulunamadı");

    const odenen = kayit.kasaBankaHarekets.reduce(
      (toplam, hareket) => toplam.add(hareket.tutarTry.div(kayit.kur)),
      new Prisma.Decimal(0),
    ).add(kayit.krediKartiHareketleri.reduce((toplam, hareket) => toplam.add(hareket.cariOdemeTutari ?? 0), D(0)));
    const kalan = Prisma.Decimal.max(kayit.genelToplam.sub(odenen), 0);

    return {
      ...this.gorunum(kayit),
      cari: kayit.cari,
      satirlar: kayit.satirlar.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        varyantId: s.varyantId,
        varyant: s.varyant,
        partiBilgileri: s.partiBilgileri,
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
        hareketler: [...kayit.kasaBankaHarekets.map((hareket) => ({
          id: hareket.id,
          tip: hareket.tip,
          tutar: hareket.tutar.toFixed(2),
          tutarTry: hareket.tutarTry.toFixed(2),
          dovizCinsi: hareket.dovizCinsi,
          tarih: hareket.tarih.toISOString().slice(0, 10),
          aciklama: hareket.aciklama,
          hesap: hareket.kasa?.ad ?? hareket.bankaHesap?.ad ?? "Hesap belirtilmedi",
          createdAt: hareket.createdAt.toISOString(),
        })), ...kayit.krediKartiHareketleri.map((hareket) => ({ id: hareket.id, tip: "kredi_karti", tutar: (hareket.cariOdemeTutari ?? D(0)).toFixed(2), dovizCinsi: kayit.dovizCinsi, tarih: hareket.tarih.toISOString().slice(0, 10), aciklama: hareket.aciklama, hesap: hareket.krediKarti.ad, createdAt: hareket.createdAt.toISOString() }))],
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
      await this.cariTipiniDogrula(tx, girdi.cariId, girdi.tip);

      const cari = await tx.cariHesap.findUnique({
        where: { id: girdi.cariId },
        select: { varsayilanVadeGun: true },
      });

      let hesaplananVadeTarihi: Date;
      if (girdi.vadeTarihi) {
        hesaplananVadeTarihi = new Date(girdi.vadeTarihi);
      } else if (cari?.varsayilanVadeGun && cari.varsayilanVadeGun > 0) {
        const d = new Date(girdi.tarih);
        d.setDate(d.getDate() + cari.varsayilanVadeGun);
        hesaplananVadeTarihi = d;
      } else {
        hesaplananVadeTarihi = new Date(girdi.tarih);
      }

      // Fatura kafasını oluştur
      const fatura = await tx.fatura.create({
        data: {
          tenantId,
          tip: girdi.tip,
          gelirTuru: girdi.gelirTuru ?? "ticari_satis",
          durum: "taslak",
          no: girdi.no ?? null,
          tarih: new Date(girdi.tarih),
          vadeTarihi: hesaplananVadeTarihi,
          siparisNo: girdi.siparisNo ?? null,
          siparisTarihi: girdi.siparisTarihi ? new Date(girdi.siparisTarihi) : null,
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
        await this.stokService.varyantDogrula(tx, s.stokId, orijinalSatir.varyantId);
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: fatura.id,
            stokId: s.stokId,
            varyantId: orijinalSatir.varyantId,
            partiBilgileri: orijinalSatir.partiBilgileri,
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
            projeId: orijinalSatir.projeId,
            projeAltKirilimId: orijinalSatir.projeAltKirilimId,
          },
        });
      }

      return this.gorunum(fatura);
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof faturaGuncelleSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    const fatura = await this.getir(id);

    const kesinDuzenleme = fatura.durum === "kesin" && !fatura.ebelge;
    if ((fatura.durum !== "taslak" && !kesinDuzenleme) || fatura.ebelge) {
      throw new BadRequestException("Yalnızca e-Belgesi gönderilmemiş faturalar güncellenebilir");
    }

    // Kesinleşmiş ancak henüz e-belgeye dönüşmemiş faturanın stok yönünü,
    // deposunu veya cari bağlantısını değiştirmek mevcut hareketleri bozar.
    // Tutar/iskonto/vergi ve açıklama düzeltmeleri serbest; stok etkisi doğuran
    // alanlar sabit tutulur. Cari hareketi aşağıda aynı transaction'da güncellenir.
    if (kesinDuzenleme) {
      if (girdi.tip !== undefined && girdi.tip !== fatura.tip) throw new BadRequestException("Gönderilmemiş kesin faturada fatura tipi değiştirilemez");
      if (girdi.cariId !== undefined && girdi.cariId !== fatura.cari.id) throw new BadRequestException("Gönderilmemiş kesin faturada cari değiştirilemez");
      if (girdi.depoId !== undefined && (girdi.depoId ?? null) !== (fatura.depoId ?? null)) throw new BadRequestException("Gönderilmemiş kesin faturada depo değiştirilemez");
      if (girdi.dovizCinsi !== undefined && girdi.dovizCinsi !== fatura.dovizCinsi) throw new BadRequestException("Gönderilmemiş kesin faturada döviz değiştirilemez");
      if (girdi.kur !== undefined && Number(girdi.kur) !== Number(fatura.kur)) throw new BadRequestException("Gönderilmemiş kesin faturada kur değiştirilemez");
      if (girdi.satirlar) {
        const eski = fatura.satirlar.map((s) => `${s.stokId}|${s.varyantId ?? ""}|${s.miktar}|${s.birim}`).join(";");
        const yeni = girdi.satirlar.map((s) => `${s.stokId}|${s.varyantId ?? ""}|${s.miktar}|${s.birim}`).join(";");
        if (eski !== yeni) throw new BadRequestException("Gönderilmemiş kesin faturada stok ve miktar değiştirilemez; yeni taslak oluşturun");
      }
    }

    // Tam güncelleme için girdiyi tamamla
    const birlesikGirdi = {
      tip: girdi.tip ?? (fatura.tip as z.infer<typeof faturaOlusturSemasi>["tip"]),
      no: girdi.no !== undefined ? girdi.no : fatura.no,
      tarih: girdi.tarih ?? fatura.tarih,
      vadeTarihi: girdi.vadeTarihi !== undefined ? girdi.vadeTarihi : fatura.vadeTarihi,
      siparisNo: girdi.siparisNo !== undefined ? girdi.siparisNo : fatura.siparisNo,
      siparisTarihi: girdi.siparisTarihi !== undefined ? (girdi.siparisTarihi ? new Date(girdi.siparisTarihi) : null) : fatura.siparisTarihi,
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
          varyantId: s.varyantId,
          partiBilgileri: s.partiBilgileri as z.infer<typeof faturaOlusturSemasi>["satirlar"][number]["partiBilgileri"],
          miktar: s.miktar,
          birim: s.birim,
          birimFiyat: s.birimFiyat,
          iskontoOrani: s.iskontoOrani,
          kdvOrani: s.kdvOrani,
          tevkifatPay: s.tevkifatPay,
          tevkifatPayda: s.tevkifatPayda,
          gibIstisnaKodu: s.gibIstisnaKodu,
          projeId: (s as any).projeId ?? undefined,
          projeAltKirilimId: (s as any).projeAltKirilimId ?? undefined,
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
      await this.cariTipiniDogrula(tx, birlesikGirdi.cariId, birlesikGirdi.tip);
      // Satırları sil ve yeniden ekle
      await tx.faturaSatir.deleteMany({ where: { faturaId: id } });

      // Sıralı await (async forEach P2028 hatası — olustur ile aynı düzeltme)
      for (const [index, s] of hesaplanan.satirlar.entries()) {
        const orijinalSatir = birlesikGirdi.satirlar[index];
        await this.stokService.varyantDogrula(tx, s.stokId, orijinalSatir.varyantId);
        await tx.faturaSatir.create({
          data: {
            tenantId,
            faturaId: id,
            stokId: s.stokId,
            varyantId: orijinalSatir.varyantId,
            partiBilgileri: orijinalSatir.partiBilgileri,
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
            projeId: orijinalSatir.projeId,
            projeAltKirilimId: orijinalSatir.projeAltKirilimId,
          },
        });
      }

      const guncellenen = await tx.fatura.update({
        where: { id },
        data: {
          tip: birlesikGirdi.tip,
          no: birlesikGirdi.no ?? null,
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

      if (kesinDuzenleme) {
        await tx.cariHareket.updateMany({
          where: { tenantId, kaynakTur: "fatura", kaynakRef: id },
          data: {
            tutar: D(hesaplanan.genelToplam),
            dovizCinsi: birlesikGirdi.dovizCinsi,
            kur: D(birlesikGirdi.kur),
            tutarTry: D(hesaplanan.genelToplam).mul(D(birlesikGirdi.kur)).toDecimalPlaces(2),
            tarih: new Date(birlesikGirdi.tarih),
            vadeTarihi: birlesikGirdi.vadeTarihi ? new Date(birlesikGirdi.vadeTarihi) : null,
            aciklama: `${fatura.no ?? "Fatura"} nolu fatura hareketi`,
          },
        });
      }

      return this.gorunum(guncellenen);
    });
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const fatura = await this.getir(id);

    if (fatura.durum !== "taslak" || fatura.ebelge) {
      throw new BadRequestException("Yalnızca e-Belgesi oluşmamış taslak faturalar silinebilir");
    }

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      // FTR-12: taslak zincir faturası siliniyorsa bağlı belgeler yeniden
      // dönüştürülebilir olsun diye onaylı durumuna döner (rezerv zaten
      // fatura kesinleşmediği için çözülmemişti).
      await tx.belge.updateMany({
        where: { faturaId: id },
        data: { faturaId: null, durum: "onaylandi" },
      });
      await tx.gelenEbelge.updateMany({
        where: { faturaId: id },
        data: { faturaId: null, durum: "beklemede" },
      });
      await tx.fatura.delete({ where: { id } });
    });
  }

  /**
   * Taslağı kayıt izini koruyarak iptal eder. Kesin ve e-belgesiz faturada
   * mali kayıtlar silinmez; stok ve cari için ters hareket üretilir.
   */
  async iptal(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id },
        include: { ebelge: { select: { id: true } } },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum === "iptal") throw new BadRequestException("Fatura zaten iptal edilmiş");
      if (fatura.ebelge) throw new BadRequestException("e-Belge kaydı oluşmuş fatura iptal edilemez");

      if (fatura.durum === "taslak") {
        await tx.belge.updateMany({ where: { faturaId: id }, data: { faturaId: null, durum: "onaylandi" } });
        await tx.gelenEbelge.updateMany({ where: { faturaId: id }, data: { faturaId: null, durum: "beklemede" } });
        return tx.fatura.update({ where: { id }, data: { durum: "iptal" } });
      }

      const [kasaBankaSayisi, posSayisi, krediKartiSayisi] = await Promise.all([
        tx.kasaBankaHareket.count({ where: { faturaId: id } }),
        tx.posTahsilat.count({ where: { faturaId: id } }),
        tx.krediKartiHareket.count({ where: { faturaId: id } }),
      ]);
      if (kasaBankaSayisi + posSayisi + krediKartiSayisi > 0) {
        throw new BadRequestException("Tahsilat veya ödeme bağlı fatura doğrudan iptal edilemez; önce finans hareketini geri alın veya iade faturası düzenleyin");
      }

      if (fatura.tip !== "proforma") {
        const hareketler = await tx.stokHareket.findMany({
          where: { kaynakTur: "fatura", kaynakRef: id },
          include: { partiler: { include: { parti: true } } },
          orderBy: { createdAt: "asc" },
        });
        for (const hareket of hareketler) {
          await this.stokService.hareketEkle(tx, {
            stokId: hareket.stokId,
            varyantId: hareket.varyantId,
            depoId: hareket.depoId,
            tip: hareket.tip === "cikis" ? "giris" : "cikis",
            miktar: hareket.miktar,
            girilenBirim: hareket.girilenBirim,
            girilenMiktar: hareket.girilenMiktar,
            birimMaliyet: hareket.maliyet,
            tarih: new Date(),
            aciklama: `${fatura.no || fatura.id} nolu fatura iptal ters hareketi`,
            kaynakTur: "fatura_iptal",
            kaynakRef: fatura.id,
            partiler: hareket.partiler.map((parti) => ({
              lotNo: parti.parti.lotNo,
              seriNo: parti.parti.seriNo,
              sonKullanmaTarihi: parti.parti.sonKullanmaTarihi?.toISOString().slice(0, 10) ?? null,
              uretimTarihi: parti.parti.uretimTarihi?.toISOString().slice(0, 10) ?? null,
              miktar: parti.miktar.abs(),
            })),
          });
        }

        const cariHareketTip = fatura.tip === "satis" || fatura.tip === "alis_iade" ? "alacak" : "borc";
        await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: fatura.cariId,
            tip: cariHareketTip,
            tutar: fatura.genelToplam,
            dovizCinsi: fatura.dovizCinsi,
            kur: fatura.kur,
            tutarTry: fatura.genelToplam.mul(fatura.kur).toDecimalPlaces(2),
            tarih: new Date(),
            aciklama: `${fatura.no || fatura.id} nolu fatura iptal ters hareketi`,
            kaynakTur: "fatura_iptal",
            kaynakRef: fatura.id,
          },
        });
      }
      return tx.fatura.update({ where: { id }, data: { durum: "iptal" } });
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
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
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
            varyantId: s.varyantId,
            partiBilgileri: s.partiBilgileri ?? Prisma.JsonNull,
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
          satirlar: { select: { stokId: true, varyantId: true, miktar: true } },
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
              satirlar: { select: { stokId: true, varyantId: true, miktar: true } },
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
            varyantId: s.varyantId,
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
            partiler: this.partiBilgileriniOku(s.partiBilgileri),
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

      return { kesinFatura: { ...this.gorunum(kesinFatura), riskUyari, stokUyarilari } };
    });

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

  private partiBilgileriniOku(deger: Prisma.JsonValue | null) {
    if (!Array.isArray(deger)) return [];
    return deger.flatMap((p) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return [];
      const kayit = p as Record<string, Prisma.JsonValue>;
      if (typeof kayit.lotNo !== "string" || typeof kayit.miktar !== "string") return [];
      return [{ lotNo: kayit.lotNo, seriNo: typeof kayit.seriNo === "string" ? kayit.seriNo : null, sonKullanmaTarihi: typeof kayit.sonKullanmaTarihi === "string" ? kayit.sonKullanmaTarihi : null, uretimTarihi: typeof kayit.uretimTarihi === "string" ? kayit.uretimTarihi : null, miktar: D(kayit.miktar) }];
    });
  }

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
    siparisNo: string | null;
    siparisTarihi: Date | null;
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
    tekrarlayanPlanId?: string | null;
    planlananTarih?: Date | null;
    satirlar?: Array<{
      id: string;
      stokId: string;
      varyantId?: string | null;
      miktar: Prisma.Decimal;
      birimFiyat: Prisma.Decimal;
      iskontoOrani: Prisma.Decimal;
      iskontoTutari?: Prisma.Decimal;
      netTutar?: Prisma.Decimal;
      kdvOrani: Prisma.Decimal;
      kdvTutari?: Prisma.Decimal;
      tevkifatOrani?: number;
      tevkifatTutari?: Prisma.Decimal;
      satirToplami?: Prisma.Decimal;
      gibIstisnaKodu?: string | null;
      projeId?: string | null;
      projeAltKirilimId?: string | null;
      proje?: { id: string; kod: string; ad: string } | null;
      projeAltKirilim?: { id: string; kod: string; ad: string } | null;
      stok?: { id: string; kod: string; ad: string } | null;
    }>;
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
      siparisNo: k.siparisNo,
      siparisTarihi: k.siparisTarihi?.toISOString().slice(0, 10) ?? null,
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
      tekrarlayanPlanId: k.tekrarlayanPlanId ?? null,
      planlananTarih: k.planlananTarih?.toISOString().slice(0, 10) ?? null,
      satirlar: k.satirlar?.map((s) => ({
        id: s.id,
        stokId: s.stokId,
        varyantId: s.varyantId ?? null,
        miktar: s.miktar !== undefined && s.miktar !== null ? D(s.miktar).toNumber() : 0,
        birimFiyat: s.birimFiyat !== undefined && s.birimFiyat !== null ? D(s.birimFiyat).toFixed(2) : "0.00",
        iskontoOrani: s.iskontoOrani !== undefined && s.iskontoOrani !== null ? D(s.iskontoOrani).toFixed(2) : "0.00",
        iskontoTutari: s.iskontoTutari !== undefined && s.iskontoTutari !== null ? D(s.iskontoTutari).toFixed(2) : "0.00",
        netTutar: s.netTutar !== undefined && s.netTutar !== null ? D(s.netTutar).toFixed(2) : "0.00",
        kdvOrani: s.kdvOrani !== undefined && s.kdvOrani !== null ? D(s.kdvOrani).toFixed(2) : "0.00",
        kdvTutari: s.kdvTutari !== undefined && s.kdvTutari !== null ? D(s.kdvTutari).toFixed(2) : "0.00",
        tevkifatOrani: s.tevkifatOrani ?? 0,
        tevkifatTutari: s.tevkifatTutari !== undefined && s.tevkifatTutari !== null ? D(s.tevkifatTutari).toFixed(2) : "0.00",
        satirToplami: s.satirToplami !== undefined && s.satirToplami !== null ? D(s.satirToplami).toFixed(2) : "0.00",
        gibIstisnaKodu: s.gibIstisnaKodu ?? null,
        projeId: s.projeId ?? null,
        projeAltKirilimId: s.projeAltKirilimId ?? null,
        proje: s.proje ? { id: s.proje.id, kod: s.proje.kod, ad: s.proje.ad } : null,
        projeAltKirilim: s.projeAltKirilim ? { id: s.projeAltKirilim.id, kod: s.projeAltKirilim.kod, ad: s.projeAltKirilim.ad } : null,
        stok: s.stok ? { id: s.stok.id, kod: s.stok.kod, ad: s.stok.ad } : null,
      })),
    };
  }
}
