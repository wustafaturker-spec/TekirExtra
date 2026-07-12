import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma, FaturaTip, FaturaDurum } from "@prisma/client";
import { faturaHesapla, type FaturaHesaplaSatirGirdi, type KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import { StokService } from "../stok/stok.service";
import { EbelgeKuyrukService } from "../ebelge/ebelge-kuyruk.service";
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
  ) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();

    const where: Prisma.FaturaWhereInput = {
      ...(tip ? { tip: tip as FaturaTip } : {}),
      ...(durum ? { durum: durum as FaturaDurum } : {}),
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
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => ({
        ...this.gorunum(k),
        cari: k.cari,
        ebelge: k.ebelge,
        izinliEylemler: this.eylemler(k, ctx.rol),
      })),
      sonrakiImlec,
    };
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
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Fatura bulunamadı");

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
      })),
      ebelge: kayit.ebelge,
      izinliEylemler: this.eylemler(kayit, ctx.rol),
    };
  }

  async olustur(girdi: z.infer<typeof faturaOlusturSemasi>) {
    const { tenantId } = aktifBaglam();

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

      // Satırları oluştur
      hesaplanan.satirlar.forEach(async (s, index) => {
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
          },
        });
      });

      return this.gorunum(fatura);
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof faturaGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
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
        })),
    };

    const hesaplanan = this.hesaplaFatura(birlesikGirdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Satırları sil ve yeniden ekle
      await tx.faturaSatir.deleteMany({ where: { faturaId: id } });

      hesaplanan.satirlar.forEach(async (s, index) => {
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
          },
        });
      });

      const guncellenen = await tx.fatura.update({
        where: { id },
        data: {
          tip: birlesikGirdi.tip,
          tarih: new Date(birlesikGirdi.tarih),
          vadeTarihi: birlesikGirdi.vadeTarihi ? new Date(birlesikGirdi.vadeTarihi) : null,
          cariId: birlesikGirdi.cariId,
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

    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fatura.delete({ where: { id } }),
    );
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

      // 2. Stok Hareketlerinin Tetiklenmesi (FTR-03):
      // Satış/Alış_İade -> Çıkış hareketi (Stok azalır).
      // Alış/Satış_İade -> Giriş hareketi (Stok artar).
      // Proforma fatura stoğu etkilemez.
      if (fatura.tip !== "proforma") {
        for (const s of fatura.satirlar) {
          const tip =
            fatura.tip === "satis" || fatura.tip === "alis_iade" ? "cikis" : "giris";

          await this.stokService.hareketEkle(
            tx,
            s.stokId,
            tip,
            s.miktar,
            s.birim,
            s.miktar,
            s.birimFiyat,
            new Date(fatura.tarih),
            `${faturaNo || fatura.id} nolu fatura hareketi`,
            "fatura",
            fatura.id,
          );
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
        },
      });

      return { kesinFatura: this.gorunum(kesinFatura), ebelgeGerekli };
    });

    if (sonuc.ebelgeGerekli) {
      this.ebelgeKuyrukService.kuyrugaEkle(id);
    }

    return sonuc.kesinFatura;
  }

  // ─── PDF ÜRETİMİ (FTR-07) ────────────────────────────────────────────────

  async pdfUret(id: string) {
    const fatura = await this.getir(id);

    // FTR-07: Gerçek PDF kütüphaneleri (Playwright vb.) gelene kadar,
    // yazdırılabilir bir HTML şablonu/akışı dönüyoruz (T-02 Kararı).
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <title>Fatura ${fatura.no || "Taslak"}</title>
          <style>
            body { font-family: sans-serif; padding: 2rem; color: #1c1917; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1c1917; padding-bottom: 1rem; }
            .details { margin: 2rem 0; display: flex; justify-content: space-between; }
            table { width: 100%; border-collapse: collapse; margin-top: 2rem; }
            th, td { border: 1px solid #e7e5e4; padding: 0.75rem; text-align: left; }
            th { background: #fafaf9; }
            .totals { margin-top: 2rem; display: flex; flex-direction: column; align-items: flex-end; }
            .total-row { display: flex; justify-content: space-between; width: 250px; padding: 0.35rem 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h2>TEKİREXTRA SAAS</h2>
              <p>Örnek Mahallesi, No: 123, İstanbul</p>
            </div>
            <div>
              <h1>FATURA</h1>
              <p><strong>Fatura No:</strong> ${fatura.no || "TASLAK"}</p>
              <p><strong>Tarih:</strong> ${fatura.tarih}</p>
            </div>
          </div>
          <div class="details">
            <div>
              <h3>Müşteri/Cari:</h3>
              <p><strong>${fatura.cari.unvan}</strong></p>
              <p>VKN/TCKN: ${fatura.cari.vknTckn || "-"}</p>
            </div>
            <div>
              <p><strong>Döviz:</strong> ${fatura.dovizCinsi}</p>
              <p><strong>Kur:</strong> ${fatura.kur}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Ürün/Hizmet</th>
                <th>Miktar</th>
                <th>Birim Fiyat</th>
                <th>İskonto</th>
                <th>KDV</th>
                <th>Toplam</th>
              </tr>
            </thead>
            <tbody>
              ${fatura.satirlar
                .map(
                  (s) => `
                <tr>
                  <td>${s.stokAd}</td>
                  <td>${s.miktar} ${s.birim}</td>
                  <td>${s.birimFiyat}</td>
                  <td>%${s.iskontoOrani}</td>
                  <td>%${s.kdvOrani}</td>
                  <td>${s.toplamTutar}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
          <div class="totals">
            <div class="total-row"><span>Brüt Toplam:</span> <strong>${fatura.toplamBrut}</strong></div>
            <div class="total-row"><span>İskonto Toplam:</span> <strong>${Number(fatura.toplamSatirIskontosu) + Number(fatura.genelIskontoToplam)}</strong></div>
            <div class="total-row"><span>KDV Matrahı:</span> <strong>${fatura.toplamMatrah}</strong></div>
            <div class="total-row"><span>Hesaplanan KDV:</span> <strong>${fatura.toplamKdv}</strong></div>
            ${Number(fatura.toplamTevkifat) > 0 ? `<div class="total-row"><span>Tevkif Edilen KDV:</span> <strong>${fatura.toplamTevkifat}</strong></div>` : ""}
            <div class="total-row" style="border-top: 2px double #1c1917; padding-top: 0.5rem; font-size: 1.2rem;">
              <span>Genel Toplam:</span> <strong>${fatura.genelToplam} ${fatura.dovizCinsi}</strong>
            </div>
          </div>
        </body>
      </html>
    `;

    return {
      stream: Buffer.from(html, "utf-8"),
      filename: `fatura-${fatura.no || "taslak"}.html`,
    };
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
