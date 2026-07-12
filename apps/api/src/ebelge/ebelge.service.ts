import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BelgeDurum, EbelgeTur, Prisma } from "@prisma/client";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { faturaUblUret } from "./xml-uretec";

@Injectable()
export class EbelgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilarService: BaglantilarService,
  ) {}

  // ─── E-BELGE GÖNDERİMİ (EBLG-01/02/06/07) ──────────────────────────────────

  async gonder(faturaId: string) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Faturayı, satırlarını, ürünlerini ve cari bilgisini çek
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: {
          satirlar: { include: { stok: { select: { kod: true, ad: true } } } },
          cari: true,
          ebelge: true,
        },
      });

      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin") {
        throw new BadRequestException("Yalnızca kesinleşmiş faturalar gönderilebilir");
      }

      // 2. Aktif e-belge bağlantısını bul
      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });

      if (!baglanti) {
        throw new BadRequestException(
          "Aktif bir e-belge entegratör bağlantısı bulunamadı. Lütfen ayarlardan aktifleştirin.",
        );
      }

      const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
      const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

      // 3. Alıcının VKN/TCKN durumuna göre e-Fatura/e-Arşiv ayrımı (EBLG-01)
      const mukellefiyet = await adapter.mukellefSorgula(cfg, fatura.cari.vknTckn || "");
      
      // Cari mükellefiyet kaydını veritabanında güncelle
      await tx.cariHesap.update({
        where: { id: fatura.cariId },
        data: {
          eFaturaMukellefi: mukellefiyet.eFaturaMukellefi,
          mukellefiyetSorguZamani: new Date(),
        },
      });

      const tur: EbelgeTur = mukellefiyet.eFaturaMukellefi ? "efatura" : "earsiv";

      // 4. Firmamız (Tenant/Gonderen) bilgilerini çek
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException("Tenant bulunamadı");

      // 5. UBL-TR XML üret (EBLG-02)
      const xml = faturaUblUret(fatura, {
        unvan: tenant.unvan,
        vkn: tenant.vkn,
        vergiDairesi: tenant.vergiDairesi || undefined,
      });

      // 6. Belgeyi Entegratöre Gönder (EBLG-03/06)
      const gonderimResult = await adapter.belgeGonder(cfg, {
        uuid: fatura.id,
        belgeNo: fatura.no || "TASLAK",
        xml,
        tur: tur === "efatura" ? "efatura" : "earsiv",
      });

      // 7. e-Belge Kaydını güncelle veya oluştur (durum: iletildi/hata)
      const durum: BelgeDurum = gonderimResult.basarili ? "iletildi" : "hata";

      const ebelgeKayit = await tx.ebelgeKayit.upsert({
        where: { faturaId },
        create: {
          tenantId,
          faturaId,
          tur,
          durum,
          entegratorRef: gonderimResult.belgeRef || null,
          hataMesaji: gonderimResult.hataMesaji || null,
        },
        update: {
          tur,
          durum,
          entegratorRef: gonderimResult.belgeRef || null,
          hataMesaji: gonderimResult.hataMesaji || null,
        },
      });

      // 8. XML arşiv kaydını oluştur (EBLG-07)
      if (gonderimResult.basarili) {
        await tx.ebelgeArsiv.upsert({
          where: { ebelgeId: ebelgeKayit.id },
          create: {
            tenantId,
            ebelgeId: ebelgeKayit.id,
            xmlIcerik: xml,
            pdfDosyaUrl: `/panel/fatura/${faturaId}/pdf`, // v1.0 içi pdf url
          },
          update: {
            xmlIcerik: xml,
          },
        });
      }

      return {
        basarili: gonderimResult.basarili,
        durum,
        tur,
        ebelgeRef: gonderimResult.belgeRef,
        hataMesaji: gonderimResult.hataMesaji,
      };
    });
  }

  // ─── DURUM SORGULAMA (EBLG-03/06) ──────────────────────────────────────────

  async durumSorgula(faturaId: string) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const ebelge = await tx.ebelgeKayit.findUnique({
        where: { faturaId },
      });

      if (!ebelge) throw new NotFoundException("Faturaya ait e-belge kaydı bulunamadı");
      if (!ebelge.entegratorRef) {
        throw new BadRequestException("Gönderimi yapılmamış belgenin durumu sorgulanamaz");
      }

      // Eğer zaten son duruma (kabul/ret/hata) ulaşmışsa entegratöre gitme
      if (["kabul", "ret", "hata"].includes(ebelge.durum)) {
        return ebelge;
      }

      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });
      if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

      const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
      const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

      // Entegratörden güncel durumu sorgula
      const sonuc = await adapter.durumSorgula(cfg, ebelge.entegratorRef);

      // Durumu veritabanında güncelle
      return tx.ebelgeKayit.update({
        where: { id: ebelge.id },
        data: {
          durum: sonuc.durum,
          hataMesaji: sonuc.detay || null,
        },
      });
    });
  }

  // ─── GELEN E-FATURALARI ÇEK (EBLG-08) ──────────────────────────────────────

  async gelenBelgeleriCek() {
    const { tenantId } = aktifBaglam();

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      }),
    );

    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    // Son 30 günlük gelen faturaları çek
    const otuzGunOnce = new Date();
    otuzGunOnce.setDate(otuzGunOnce.getDate() - 30);

    const belgeler = await adapter.gelenBelgeleriCek(cfg, otuzGunOnce);

    const eklenenler: string[] = [];

    // Gelen her fatura için sistemde Cari kontrolü ve taslak Alış Faturası oluşturma
    for (const b of belgeler) {
      await this.prisma.tenantIslem(tenantId, async (tx) => {
        // Zaten eklenmiş mi kontrol et
        const mevcut = await tx.fatura.findFirst({
          where: { tenantId, no: b.belgeNo, tip: "alis" },
        });
        if (mevcut) return;

        // Cari hesabı bul veya oluştur (VKN/TCKN üzerinden)
        let cari = await tx.cariHesap.findFirst({
          where: { tenantId, vknTckn: b.gonderenVkn },
        });

        if (!cari) {
          cari = await tx.cariHesap.create({
            data: {
              tenantId,
              kod: `CARİ-${b.gonderenVkn}`,
              unvan: b.gonderenUnvan,
              vknTckn: b.gonderenVkn,
              tip: "tedarikci",
            },
          });
        }

        // Taslak Alış Faturası oluştur (EBLG-08)
        const fatura = await tx.fatura.create({
          data: {
            tenantId,
            tip: "alis",
            durum: "taslak",
            no: b.belgeNo,
            tarih: b.tarih,
            cariId: cari.id,
            dovizCinsi: "TRY",
            kur: 1.0,
            toplamBrut: 0,
            toplamSatirIskontosu: 0,
            genelIskontoToplam: 0,
            toplamMatrah: 0,
            toplamKdv: 0,
            toplamTevkifat: 0,
            toplamNetKdv: 0,
            genelToplam: 0,
            aciklama: `Gelen e-Fatura (${b.gonderenUnvan})`,
          },
        });

        eklenenler.push(fatura.id);
      });
    }

    return {
      toplamCekilen: belgeler.length,
      yeniFaturaSayisi: eklenenler.length,
      eklenenFaturaIdler: eklenenler,
    };
  }
}
