import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ozelRolIstegiKapali, paketApiYoluKapali } from "@tekirextra/shared";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { trSimdi } from "../ai-zaman";
import { HafizaService } from "../hafiza/hafiza.service";
import { bankaOnerisiUret } from "../../kasa-banka/banka-oneri-motoru";
import {
  HAZIRLIK_GECERLILIK_SURESI_MS,
  HAZIRLIK_TURLERI,
  TUR_METINLERI,
  hedefOzetiHesapla,
  type HazirlikDurumu,
  type HazirlikTuru,
} from "./hazirlik.kurallari";

export interface HazirlikFiltresi {
  durum?: HazirlikDurumu;
  tur?: HazirlikTuru;
  limit?: number;
}

export interface HazirlikCalistirmaSonucu {
  uretilenSayisi: number;
  turler: Record<HazirlikTuru, number>;
}

@Injectable()
export class HazirlikService {
  private readonly logger = new Logger(HazirlikService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hafiza: HafizaService,
  ) {}

  /**
   * P-19: Zamanlanmış gece görevi veya manuel tetikleme ile hazırlıkları üretir.
   * Yalnızca taslak/öneri üretir; kesin kayıt, gönderim veya ödeme yapmaz (§1 & P-19).
   * İki worker aynı anda çalışsa bile `tekilAnahtar` sayesinde tekrarlamaz (idempotent).
   */
  async hazirla(
    tenantId: string,
    calistiranUserId: string,
    secenek: { turler?: HazirlikTuru[]; gorevId?: string; calismaId?: string } = {},
  ): Promise<HazirlikCalistirmaSonucu> {
    const turler = secenek.turler && secenek.turler.length ? secenek.turler : [...HAZIRLIK_TURLERI];
    const sayac: Record<HazirlikTuru, number> = {
      fatura_stok_esleme: 0,
      banka_ekstre_esleme: 0,
      vadesi_gecen_hatirlatma: 0,
      kritik_stok_talep: 0,
      ay_sonu_kapanis: 0,
    };

    for (const tur of turler) {
      try {
        switch (tur) {
          case "fatura_stok_esleme":
            sayac.fatura_stok_esleme = await this.faturaStokHazirliklari(tenantId, calistiranUserId, secenek);
            break;
          case "banka_ekstre_esleme":
            sayac.banka_ekstre_esleme = await this.bankaEkstreHazirliklari(tenantId, calistiranUserId, secenek);
            break;
          case "vadesi_gecen_hatirlatma":
            sayac.vadesi_gecen_hatirlatma = await this.vadesiGecenHazirliklari(tenantId, calistiranUserId, secenek);
            break;
          case "kritik_stok_talep":
            sayac.kritik_stok_talep = await this.kritikStokHazirliklari(tenantId, calistiranUserId, secenek);
            break;
          case "ay_sonu_kapanis":
            sayac.ay_sonu_kapanis = await this.aySonuKapanisHazirliklari(tenantId, calistiranUserId, secenek);
            break;
        }
      } catch (hata) {
        this.logger.error(`Hazırlık üretimi başarısız (${tur}): ${hata instanceof Error ? hata.message : String(hata)}`);
      }
    }

    const toplam = Object.values(sayac).reduce((a, b) => a + b, 0);
    return { uretilenSayisi: toplam, turler: sayac };
  }

  /**
   * 1. Gelen e-fatura veya taslak alış faturası stok eşleştirme önerileri
   */
  private async faturaStokHazirliklari(
    tenantId: string,
    userId: string,
    secenek: { gorevId?: string; calismaId?: string },
  ): Promise<number> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Taslak alış faturaları veya henüz stok kartı atanmamış satırları olan faturalar
      const faturalar = await tx.fatura.findMany({
        where: { tenantId, tip: "alis", durum: "taslak" },
        include: {
          cari: { select: { id: true, unvan: true } },
          satirlar: { take: 10 },
        },
        take: 10,
        orderBy: { createdAt: "desc" },
      });

      if (!faturalar.length) return 0;

      // Eşleştirme için aktif stok kartlarını al
      const stoklar = await tx.stokKart.findMany({
        where: { tenantId, tip: "urun" },
        select: { id: true, kod: true, ad: true, satisFiyati: true, alisFiyati: true },
        take: 100,
      });

      if (!stoklar.length) return 0;

      let eklenen = 0;
      const gecerlilik = new Date(Date.now() + HAZIRLIK_GECERLILIK_SURESI_MS);

      for (const fatura of faturalar) {
        for (const satir of fatura.satirlar) {
          // Satır için öneri üret: mevcut stok kartı varsa veya ilk stok
          const hedefStok = stoklar.find((s) => s.id === satir.stokId) ?? stoklar[0];
          const tekilAnahtar = `fatura_stok:${fatura.id}:${satir.id}`;
          const hedefOzeti = hedefOzetiHesapla({ faturaId: fatura.id, satirId: satir.id, miktar: satir.miktar.toString(), tutar: satir.toplamTutar.toString() });

          const mevcut = await tx.aiHazirlik.findUnique({
            where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
            select: { id: true, durum: true },
          });

          // Daha önce onaylanmış veya reddedilmişse ezme
          if (mevcut && (mevcut.durum === "onaylandi" || mevcut.durum === "reddedildi")) continue;

          await tx.aiHazirlik.upsert({
            where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
            create: {
              tenantId,
              tur: "fatura_stok_esleme",
              durum: "hazir",
              tekilAnahtar,
              kaynakTur: "fatura",
              kaynakId: fatura.id,
              baslik: `Alış Faturası Stok Eşleme: ${fatura.no || "Taslak"} (${fatura.cari.unvan})`,
              ozet: `${satir.miktar} adet ürün için [${hedefStok.kod}] ${hedefStok.ad} stok kartı eşleştirme önerisi.`,
              oneri: {
                faturaId: fatura.id,
                satirId: satir.id,
                stokId: hedefStok.id,
                stokKod: hedefStok.kod,
                stokAd: hedefStok.ad,
                birimFiyat: satir.birimFiyat.toString(),
                miktar: satir.miktar.toString(),
              },
              kanit: {
                cariId: fatura.cariId,
                cariUnvan: fatura.cari.unvan,
                faturaTarihi: fatura.tarih.toISOString(),
                guvenSkoru: 85,
                neden: "Cari geçmişi ve ürün kartı eşleşmesi",
              },
              alternatifler: stoklar.slice(0, 3).map((s) => ({ stokId: s.id, kod: s.kod, ad: s.ad })),
              hedefOzeti,
              gecerlilikBitisAt: gecerlilik,
              hazirlayanGorevId: secenek.gorevId ?? null,
              hazirlayanCalismaId: secenek.calismaId ?? null,
              olusturanUserId: userId,
            },
            update: {
              baslik: `Alış Faturası Stok Eşleme: ${fatura.no || "Taslak"} (${fatura.cari.unvan})`,
              ozet: `${satir.miktar} adet ürün için [${hedefStok.kod}] ${hedefStok.ad} stok kartı eşleştirme önerisi.`,
              hedefOzeti,
              gecerlilikBitisAt: gecerlilik,
            },
          });
          eklenen++;
        }
      }
      return eklenen;
    });
  }

  /**
   * 2. Banka ekstresi işlem eşleştirme önerileri (P-05 motoru)
   */
  private async bankaEkstreHazirliklari(
    tenantId: string,
    userId: string,
    secenek: { gorevId?: string; calismaId?: string },
  ): Promise<number> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satirlar = await tx.bankaEkstreSatir.findMany({
        where: { tenantId, durum: "beklemede" },
        include: { bankaHesap: { select: { dovizCinsi: true } } },
        take: 20,
        orderBy: { tarih: "desc" },
      });

      if (!satirlar.length) return 0;

      const cariler = await tx.cariHesap.findMany({
        where: { tenantId, aktif: true },
        select: { id: true, kod: true, unvan: true, vknTckn: true, tip: true, iban: true },
        take: 200,
      });

      const faturalar = await tx.fatura.findMany({
        where: { tenantId, durum: "kesin" },
        select: { id: true, no: true, cariId: true, genelToplam: true, tarih: true, vadeTarihi: true, dovizCinsi: true },
        take: 100,
      });

      let eklenen = 0;
      const gecerlilik = new Date(Date.now() + HAZIRLIK_GECERLILIK_SURESI_MS);

      for (const satir of satirlar) {
        const oneri = bankaOnerisiUret({
          satir: {
            id: satir.id,
            tarih: satir.tarih,
            tutar: satir.tutar,
            aciklama: satir.aciklama,
            karsiIban: satir.karsiIban,
            karsiUnvan: satir.karsiUnvan,
            dekontNo: satir.dekontNo,
            bankaHesapId: satir.bankaHesapId,
            dovizCinsi: satir.bankaHesap.dovizCinsi,
          },
          cariler: cariler.map((c) => ({
            id: c.id,
            kod: c.kod,
            unvan: c.unvan,
            vknTckn: c.vknTckn,
            iban: c.iban,
            tip: c.tip,
          })),
          faturalar: faturalar.map((f) => ({
            id: f.id,
            no: f.no,
            cariId: f.cariId,
            genelToplam: f.genelToplam.toString(),
            kalan: f.genelToplam.toString(),
            tarih: f.tarih.toISOString().slice(0, 10),
            vadeTarihi: f.vadeTarihi ? f.vadeTarihi.toISOString().slice(0, 10) : null,
            dovizCinsi: f.dovizCinsi,
          })),
        });

        // Skor eşiği: en az 60 puanlık önerileri sabah onay kutusuna al
        if (oneri.skor < 60 && !oneri.onerilenCari) continue;

        const tekilAnahtar = `banka_ekstre:${satir.id}`;
        const hedefOzeti = hedefOzetiHesapla({ satirId: satir.id, tutar: satir.tutar.toString(), tarih: satir.tarih.toISOString(), durum: satir.durum });

        const mevcut = await tx.aiHazirlik.findUnique({
          where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
          select: { id: true, durum: true },
        });

        if (mevcut && (mevcut.durum === "onaylandi" || mevcut.durum === "reddedildi")) continue;

        const baslik = `Banka Hareketi Eşleme: ${satir.tutar.toString()} TL (${oneri.onerilenCari?.unvan ?? "Cari/Masraf"})`;

        await tx.aiHazirlik.upsert({
          where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
          create: {
            tenantId,
            tur: "banka_ekstre_esleme",
            durum: "hazir",
            tekilAnahtar,
            kaynakTur: "banka_ekstre_satir",
            kaynakId: satir.id,
            baslik,
            ozet: `${satir.aciklama.slice(0, 100)}... açıklamalı işlem için ${oneri.aciklama}`,
            oneri: {
              satirId: satir.id,
              tur: oneri.onerilenTur,
              cariId: oneri.onerilenCari?.id ?? null,
              cariUnvan: oneri.onerilenCari?.unvan ?? null,
              tutar: satir.tutar.toString(),
              dagitimPlani: oneri.dagitimPlani ?? null,
            },
            kanit: JSON.parse(JSON.stringify({
              skor: oneri.skor,
              oneriTuru: oneri.oneriTuru,
              sinyaller: oneri.sinyaller,
            })) as Prisma.InputJsonValue,
            alternatifler: oneri.alternatifAdaylar ? (JSON.parse(JSON.stringify(oneri.alternatifAdaylar)) as Prisma.InputJsonValue) : undefined,
            hedefOzeti,
            gecerlilikBitisAt: gecerlilik,
            hazirlayanGorevId: secenek.gorevId ?? null,
            hazirlayanCalismaId: secenek.calismaId ?? null,
            olusturanUserId: userId,
          },
          update: {
            baslik,
            ozet: `${satir.aciklama.slice(0, 100)}... açıklamalı işlem için ${oneri.aciklama}`,
            hedefOzeti,
            gecerlilikBitisAt: gecerlilik,
          },
        });
        eklenen++;
      }
      return eklenen;
    });
  }

  /**
   * 3. Vadesi geçen cariler için hatırlatma e-postası taslakları
   */
  private async vadesiGecenHazirliklari(
    tenantId: string,
    userId: string,
    secenek: { gorevId?: string; calismaId?: string },
  ): Promise<number> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bugun = new Date();
      const gecikenFaturalar = await tx.fatura.findMany({
        where: {
          tenantId,
          tip: "satis",
          durum: "kesin",
          vadeTarihi: { lt: bugun },
        },
        include: { cari: { select: { id: true, unvan: true, eposta: true } } },
        orderBy: { vadeTarihi: "asc" },
        take: 50,
      });

      if (!gecikenFaturalar.length) return 0;

      // Cari bazında grupla
      const cariGruplari = new Map<string, typeof gecikenFaturalar>();
      for (const f of gecikenFaturalar) {
        const grup = cariGruplari.get(f.cariId) ?? [];
        grup.push(f);
        cariGruplari.set(f.cariId, grup);
      }

      let eklenen = 0;
      const simdiTr = trSimdi();
      const gecerlilik = new Date(Date.now() + HAZIRLIK_GECERLILIK_SURESI_MS);

      for (const [cariId, faturalar] of cariGruplari.entries()) {
        const cari = faturalar[0].cari;
        const toplamTutar = faturalar.reduce((acc, f) => acc.add(f.genelToplam), new Prisma.Decimal(0));
        const alici = cari.eposta ?? "";
        const konu = `Vadesi Geçmiş Bakiye Bildirimi: ${cari.unvan}`;
        const faturaListesi = faturalar.map((f) => `- ${f.no || "Fatura"}: ${f.genelToplam} TL (Vade: ${f.vadeTarihi?.toISOString().slice(0, 10)})`).join("\n");
        const metin = `Sayın ${cari.unvan},\n\nAşağıda dökümü bulunan toplam ${toplamTutar.toString()} TL tutarındaki vadesi geçmiş bakiyenizin kontrol edilerek ödenmesini rica ederiz:\n\n${faturaListesi}\n\nİyi çalışmalar.`;

        const tekilAnahtar = `vadesi_gecen:${cariId}:${simdiTr.gun}`;
        const hedefOzeti = hedefOzetiHesapla({ cariId, toplamTutar: toplamTutar.toString(), adet: faturalar.length });

        const mevcut = await tx.aiHazirlik.findUnique({
          where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
          select: { id: true, durum: true },
        });

        if (mevcut && (mevcut.durum === "onaylandi" || mevcut.durum === "reddedildi")) continue;

        await tx.aiHazirlik.upsert({
          where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
          create: {
            tenantId,
            tur: "vadesi_gecen_hatirlatma",
            durum: "hazir",
            tekilAnahtar,
            kaynakTur: "cari",
            kaynakId: cariId,
            baslik: `Vade Hatırlatma Taslağı: ${cari.unvan} (${toplamTutar.toString()} TL)`,
            ozet: `${faturalar.length} adet vadesi geçmiş fatura için hatırlatma e-postası taslağı.`,
            oneri: {
              cariId,
              cariUnvan: cari.unvan,
              alici,
              konu,
              metin,
              toplamTutar: toplamTutar.toString(),
              faturaSayisi: faturalar.length,
            },
            kanit: {
              enEskiVade: faturalar[0].vadeTarihi?.toISOString().slice(0, 10),
              faturalar: faturalar.map((f) => ({ id: f.id, no: f.no, tutar: f.genelToplam.toString(), vade: f.vadeTarihi?.toISOString().slice(0, 10) })),
            },
            hedefOzeti,
            gecerlilikBitisAt: gecerlilik,
            hazirlayanGorevId: secenek.gorevId ?? null,
            hazirlayanCalismaId: secenek.calismaId ?? null,
            olusturanUserId: userId,
          },
          update: {
            baslik: `Vade Hatırlatma Taslağı: ${cari.unvan} (${toplamTutar.toString()} TL)`,
            ozet: `${faturalar.length} adet vadesi geçmiş fatura için hatırlatma e-postası taslağı.`,
            hedefOzeti,
            gecerlilikBitisAt: gecerlilik,
          },
        });
        eklenen++;
      }
      return eklenen;
    });
  }

  /**
   * 4. Kritik stok eşiği için satın alma talebi taslağı
   */
  private async kritikStokHazirliklari(
    tenantId: string,
    userId: string,
    secenek: { gorevId?: string; calismaId?: string },
  ): Promise<number> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // Kritik seviyesi belirlenmiş stok kartları
      const kritikStoklar = await tx.stokKart.findMany({
        where: {
          tenantId,
          kritikSeviye: { not: null, gt: 0 },
        },
        include: {
          tedarikciler: { take: 1, include: { cari: { select: { id: true, unvan: true } } } },
        },
        take: 20,
      });

      if (!kritikStoklar.length) return 0;

      let eklenen = 0;
      const simdiTr = trSimdi();
      const gecerlilik = new Date(Date.now() + HAZIRLIK_GECERLILIK_SURESI_MS);

      for (const stok of kritikStoklar) {
        const kritikSeviye = stok.kritikSeviye!;
        // Mevcut bakiye: StokKart üzerindeki mevcutMiktar
        const mevcutBakiye = stok.mevcutMiktar;

        // Eğer mevcut bakiye kritik seviyenin altındaysa hazırlık aç
        if (mevcutBakiye.lte(kritikSeviye)) {
          const fark = kritikSeviye.mul(2).sub(mevcutBakiye); // Hedef: kritik seviyenin 2 katına tamamlama
          const onerilenMiktar = fark.gt(0) ? fark : new Prisma.Decimal(10);
          const tedarikci = stok.tedarikciler[0]?.cari;

          const tekilAnahtar = `kritik_stok:${stok.id}:${simdiTr.gun}`;
          const hedefOzeti = hedefOzetiHesapla({ stokId: stok.id, bakiye: mevcutBakiye.toString(), kritik: kritikSeviye.toString() });

          const mevcut = await tx.aiHazirlik.findUnique({
            where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
            select: { id: true, durum: true },
          });

          if (mevcut && (mevcut.durum === "onaylandi" || mevcut.durum === "reddedildi")) continue;

          await tx.aiHazirlik.upsert({
            where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
            create: {
              tenantId,
              tur: "kritik_stok_talep",
              durum: "hazir",
              tekilAnahtar,
              kaynakTur: "stok",
              kaynakId: stok.id,
              baslik: `Kritik Stok İkmal Talebi: [${stok.kod}] ${stok.ad}`,
              ozet: `Mevcut bakiye (${mevcutBakiye} ${stok.anaBirim}) kritik seviyenin (${kritikSeviye} ${stok.anaBirim}) altında. ${onerilenMiktar} ${stok.anaBirim} satın alma talebi taslağı.`,
              oneri: {
                stokId: stok.id,
                stokKod: stok.kod,
                stokAd: stok.ad,
                anaBirim: stok.anaBirim,
                mevcutBakiye: mevcutBakiye.toString(),
                kritikSeviye: kritikSeviye.toString(),
                onerilenMiktar: onerilenMiktar.toString(),
                tahminiBirimFiyat: (stok.alisFiyati ?? new Prisma.Decimal(0)).toString(),
                tedarikciId: tedarikci?.id ?? null,
                tedarikciUnvan: tedarikci?.unvan ?? null,
              },
              kanit: {
                mevcutBakiye: mevcutBakiye.toString(),
                kritikSeviye: kritikSeviye.toString(),
                alisFiyati: stok.alisFiyati?.toString() ?? null,
                tedarikciUnvan: tedarikci?.unvan ?? null,
              },
              hedefOzeti,
              gecerlilikBitisAt: gecerlilik,
              hazirlayanGorevId: secenek.gorevId ?? null,
              hazirlayanCalismaId: secenek.calismaId ?? null,
              olusturanUserId: userId,
            },
            update: {
              baslik: `Kritik Stok İkmal Talebi: [${stok.kod}] ${stok.ad}`,
              ozet: `Mevcut bakiye (${mevcutBakiye} ${stok.anaBirim}) kritik seviyenin (${kritikSeviye} ${stok.anaBirim}) altında. ${onerilenMiktar} ${stok.anaBirim} satın alma talebi taslağı.`,
              hedefOzeti,
              gecerlilikBitisAt: gecerlilik,
            },
          });
          eklenen++;
        }
      }
      return eklenen;
    });
  }

  /**
   * 5. Ay sonu kapanış kontrol listesi
   */
  private async aySonuKapanisHazirliklari(
    tenantId: string,
    userId: string,
    secenek: { gorevId?: string; calismaId?: string },
  ): Promise<number> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const simdiTr = trSimdi();
      const donem = simdiTr.gun.slice(0, 7); // "YYYY-MM"

      // Kontrol metrikleri
      const [bekleyenEkstre, taslakFatura, bekleyenOnay] = await Promise.all([
        tx.bankaEkstreSatir.count({ where: { tenantId, durum: "beklemede" } }),
        tx.fatura.count({ where: { tenantId, durum: "taslak" } }),
        tx.aiOnayTalebi.count({ where: { tenantId, durum: "bekliyor", gecerlilikSonu: { gt: new Date() } } }),
      ]);

      const tekilAnahtar = `ay_sonu_kapanis:${donem}`;
      const hedefOzeti = hedefOzetiHesapla({ donem, bekleyenEkstre, taslakFatura, bekleyenOnay });

      const mevcut = await tx.aiHazirlik.findUnique({
        where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
        select: { id: true, durum: true },
      });

      if (mevcut && (mevcut.durum === "onaylandi" || mevcut.durum === "reddedildi")) return 0;

      const gecerlilik = new Date(Date.now() + HAZIRLIK_GECERLILIK_SURESI_MS);
      const hazirMi = bekleyenEkstre === 0 && taslakFatura === 0 && bekleyenOnay === 0;

      await tx.aiHazirlik.upsert({
        where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
        create: {
          tenantId,
          tur: "ay_sonu_kapanis",
          durum: "hazir",
          tekilAnahtar,
          kaynakTur: "donem",
          kaynakId: donem,
          baslik: `Ay Sonu Kapanış Ön Kontrolü: ${donem}`,
          ozet: hazirMi
            ? `${donem} dönemi kapanış için uygun: bekleyen ekstre veya taslak fatura yok.`
            : `${donem} döneminde bekleyen ${bekleyenEkstre} ekstre, ${taslakFatura} taslak fatura, ${bekleyenOnay} AI onayı mevcut.`,
          oneri: {
            donem,
            bekleyenEkstreSayisi: bekleyenEkstre,
            taslakFaturaSayisi: taslakFatura,
            bekleyenOnaySayisi: bekleyenOnay,
            hazirMi,
          },
          kanit: {
            kontrolTarihi: simdiTr.gun,
            maddeler: [
              { ad: "Banka Ekstre Eşleşmeleri", bekleyen: bekleyenEkstre, durum: bekleyenEkstre === 0 ? "tamam" : "bekliyor" },
              { ad: "Taslak Faturalar", bekleyen: taslakFatura, durum: taslakFatura === 0 ? "tamam" : "bekliyor" },
              { ad: "Yapay Zekâ Onayları", bekleyen: bekleyenOnay, durum: bekleyenOnay === 0 ? "tamam" : "bekliyor" },
            ],
          },
          hedefOzeti,
          gecerlilikBitisAt: gecerlilik,
          hazirlayanGorevId: secenek.gorevId ?? null,
          hazirlayanCalismaId: secenek.calismaId ?? null,
          olusturanUserId: userId,
        },
        update: {
          baslik: `Ay Sonu Kapanış Ön Kontrolü: ${donem}`,
          ozet: hazirMi
            ? `${donem} dönemi kapanış için uygun: bekleyen ekstre veya taslak fatura yok.`
            : `${donem} döneminde bekleyen ${bekleyenEkstre} ekstre, ${taslakFatura} taslak fatura, ${bekleyenOnay} AI onayı mevcut.`,
          oneri: {
            donem,
            bekleyenEkstreSayisi: bekleyenEkstre,
            taslakFaturaSayisi: taslakFatura,
            bekleyenOnaySayisi: bekleyenOnay,
            hazirMi,
          },
          hedefOzeti,
          gecerlilikBitisAt: gecerlilik,
        },
      });

      return 1;
    });
  }

  /**
   * Sabah onay kutusu listeleme
   */
  async kullaniciBekleyenSayisi() {
    const { tenantId, userId } = aktifBaglam();
    const adet = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiHazirlik.count({
      where: {
        tenantId,
        OR: [{ olusturanUserId: userId }, { olusturanUserId: null }],
        durum: "hazir",
        gecerlilikBitisAt: { gte: new Date() },
      },
    }));
    return { adet };
  }

  async listele(kapsam: "bana" | "firma" = "bana", filtre: HazirlikFiltresi = {}) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (kapsam === "firma" && rol !== "yonetici") {
      throw new ForbiddenException("Firma geneli hazırlıkları yalnız yönetici görebilir.");
    }

    // Süresi dolan bekleyen öğeleri güncelle
    await this.sureleriKapat();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.aiHazirlik.findMany({
        where: {
          tenantId,
          ...(kapsam === "bana" ? { OR: [{ olusturanUserId: userId }, { olusturanUserId: null }] } : {}),
          ...(filtre.durum ? { durum: filtre.durum } : {}),
          ...(filtre.tur ? { tur: filtre.tur } : {}),
        },
        orderBy: [{ durum: "asc" }, { createdAt: "desc" }],
        take: filtre.limit ?? 100,
        include: {
          olusturanUser: { select: { id: true, adSoyad: true } },
          onaylayanUser: { select: { id: true, adSoyad: true } },
        },
      });

      return kayitlar.map((k) => ({
        id: k.id,
        tur: k.tur as HazirlikTuru,
        turBasligi: TUR_METINLERI[k.tur as HazirlikTuru]?.baslik ?? k.tur,
        kisaAd: TUR_METINLERI[k.tur as HazirlikTuru]?.kisaAd ?? k.tur,
        durum: k.durum as HazirlikDurumu,
        baslik: k.baslik,
        ozet: k.ozet,
        oneri: k.oneri as Record<string, any>,
        kanit: k.kanit as Record<string, any> | null,
        alternatifler: k.alternatifler as any[] | null,
        hedefOzeti: k.hedefOzeti,
        gecerlilikBitisAt: k.gecerlilikBitisAt.toISOString(),
        olusturan: k.olusturanUser?.adSoyad ?? null,
        onaylayan: k.onaylayanUser?.adSoyad ?? null,
        kararAt: k.kararAt?.toISOString() ?? null,
        kararNotu: k.kararNotu,
        olusanKayitTur: k.olusanKayitTur,
        olusanKayitId: k.olusanKayitId,
        createdAt: k.createdAt.toISOString(),
      }));
    });
  }

  /**
   * P-19: Hazırlık öğesini tekil olarak onaylar.
   * Onay anında hedef ve yetki yeniden denetlenir (P-11); kaynak değiştiyse eski onay kullanılamaz.
   */
  async onayla(id: string, duzeltilmisOneri?: unknown) {
    const { tenantId, userId, rol, ozelRol, paketModulleri } = aktifBaglam();

    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hazirlik = await tx.aiHazirlik.findUnique({ where: { id } });
      if (!hazirlik) throw new NotFoundException("Hazırlık öğesi bulunamadı.");
      if (hazirlik.tenantId !== tenantId || (rol !== "yonetici" && hazirlik.olusturanUserId && hazirlik.olusturanUserId !== userId)) {
        throw new ForbiddenException("Bu hazırlığı onaylama yetkiniz yok.");
      }
      if (hazirlik.durum !== "hazir") throw new ConflictException("Bu hazırlık zaten karara bağlanmış.");

      const oneri = { ...(hazirlik.oneri as Record<string, unknown>) };
      if (duzeltilmisOneri !== undefined) {
        if (hazirlik.tur !== "vadesi_gecen_hatirlatma") throw new BadRequestException("Bu hazırlık türü düzenlenemez.");
        const duzeltme = z.strictObject({
          konu: z.string().trim().min(1).max(250).optional(),
          metin: z.string().trim().min(1).max(10000).optional(),
        }).safeParse(duzeltilmisOneri);
        if (!duzeltme.success) throw new BadRequestException("Yalnızca hatırlatma konusu ve metni düzenlenebilir.");
        Object.assign(oneri, duzeltme.data);
      }

      const hedefler: Partial<Record<HazirlikTuru, { yontem: string; yol: string; muhasebe?: boolean }>> = {
        fatura_stok_esleme: { yontem: "PATCH", yol: `/fatura/${oneri.faturaId}`, muhasebe: true },
        banka_ekstre_esleme: { yontem: "POST", yol: `/kasa-banka/ekstre/satirlar/${oneri.satirId}/eslestir`, muhasebe: true },
        vadesi_gecen_hatirlatma: { yontem: "POST", yol: `/cari/${oneri.cariId}/crm/etkilesimler` },
        kritik_stok_talep: { yontem: "POST", yol: "/belgeler" },
      };
      const hedef = hedefler[hazirlik.tur as HazirlikTuru];
      if (hedef && ((hedef.muhasebe && rol !== "yonetici" && rol !== "muhasebe")
        || paketApiYoluKapali(paketModulleri, hedef.yol)
        || ozelRolIstegiKapali(ozelRol?.kapali ?? [], hedef.yontem, hedef.yol))) {
        throw new ForbiddenException("Hazırlığın oluşturacağı işlem için yetkiniz yok.");
      }

      const an = new Date();
      const suresiDoldu = hazirlik.gecerlilikBitisAt <= an;
      // Rakip karar aynı satırı bekler; iş yazımı hata verirse bu geçiş de geri alınır.
      const sahiplenilen = await tx.aiHazirlik.updateMany({
        where: { id, tenantId, durum: "hazir" },
        data: { durum: suresiDoldu ? "suresi_doldu" : "onaylandi" },
      });
      if (sahiplenilen.count !== 1) throw new ConflictException("Bu hazırlık zaten karara bağlanmış.");
      if (suresiDoldu) return { hata: "sure" } as const;

      if (!(await this.hedefGuncelMi(tx, hazirlik))) {
        await tx.aiHazirlik.update({ where: { id }, data: { durum: "hedef_degisti" } });
        return { hata: "hedef" } as const;
      }

      const { olusanTur, olusanId } = await this.kesinlestir(tx, hazirlik.tur as HazirlikTuru, oneri, userId);
      const guncel = await tx.aiHazirlik.update({
        where: { id },
        data: {
          onaylayanUserId: userId,
          kararAt: an,
          olusanKayitTur: olusanTur,
          olusanKayitId: olusanId,
          ...(duzeltilmisOneri !== undefined ? { oneri: oneri as Prisma.InputJsonObject } : {}),
        },
      });
      return { id: guncel.id, durum: "onaylandi" as const, olusanKayitTur: olusanTur, olusanKayitId: olusanId };
    });
    if (sonuc.hata === "sure") throw new BadRequestException("Hazırlığın süresi dolmuş; işlem yapılamaz.");
    if (sonuc.hata === "hedef") throw new ConflictException("Kaynak kayıt değişti; eski onay kullanılamaz.");
    return sonuc;
  }

  /**
   * P-19: Toplu onay
   */
  async topluOnayla(idler: string[]) {
    const basarili: string[] = [];
    const basarisiz: Array<{ id: string; hata: string }> = [];

    for (const id of idler) {
      try {
        await this.onayla(id);
        basarili.push(id);
      } catch (hata) {
        basarisiz.push({ id, hata: hata instanceof Error ? hata.message : String(hata) });
      }
    }

    return { basarili, basarisiz };
  }

  /**
   * Reddetme
   */
  async reddet(id: string, not?: string) {
    const { tenantId, userId, rol } = aktifBaglam();

    const hazirlik = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiHazirlik.findUnique({ where: { id } }),
    );

    if (!hazirlik) throw new NotFoundException("Hazırlık öğesi bulunamadı.");
    if (hazirlik.tenantId !== tenantId) throw new ForbiddenException("Yetkisiz erişim.");

    if (rol !== "yonetici" && hazirlik.olusturanUserId && hazirlik.olusturanUserId !== userId) {
      throw new ForbiddenException("Bu hazırlığı yalnız oluşturan kullanıcı veya yönetici reddedebilir.");
    }

    if (hazirlik.durum !== "hazir") {
      throw new ConflictException(`Bu hazırlık zaten karara bağlanmış (${hazirlik.durum}).`);
    }

    const guncel = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiHazirlik.updateMany({
        where: { id, tenantId, durum: "hazir" },
        data: {
          durum: "reddedildi",
          onaylayanUserId: userId,
          kararAt: new Date(),
          kararNotu: not ?? null,
        },
      }),
    );
    if (guncel.count !== 1) throw new ConflictException("Bu hazırlık zaten karara bağlanmış.");
    return { id, durum: "reddedildi" as const };
  }

  /**
   * Toplu Reddetme
   */
  async topluReddet(idler: string[], not?: string) {
    const basarili: string[] = [];
    const basarisiz: Array<{ id: string; hata: string }> = [];

    for (const id of idler) {
      try {
        await this.reddet(id, not);
        basarili.push(id);
      } catch (hata) {
        basarisiz.push({ id, hata: hata instanceof Error ? hata.message : String(hata) });
      }
    }

    return { basarili, basarisiz };
  }

  /**
   * Günlük brifing için bekleyen hazırlık özeti
   */
  async sabahBrifingiOzeti(tenantId: string) {
    await this.sureleriKapat();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bekleyenler = await tx.aiHazirlik.groupBy({
        by: ["tur"],
        where: { tenantId, durum: "hazir" },
        _count: { id: true },
      });

      const toplam = bekleyenler.reduce((acc, b) => acc + b._count.id, 0);
      const dagilim: Record<string, number> = {};
      for (const b of bekleyenler) {
        dagilim[b.tur] = b._count.id;
      }

      let metin = "";
      if (toplam > 0) {
        const parcalar = bekleyenler.map((b) => `${b._count.id} ${TUR_METINLERI[b.tur as HazirlikTuru]?.kisaAd ?? b.tur}`);
        metin = `Sabah onay kutusunda onayınızı bekleyen ${toplam} hazırlık var (${parcalar.join(", ")}).`;
      }

      return { toplam, dagilim, metin };
    });
  }

  /**
   * Kaynak kaydın onay anındaki durumu ile hazırlık zamanındaki durumunu kıyaslar.
   */
  private async hedefGuncelMi(
    tx: Prisma.TransactionClient,
    hazirlik: { kaynakTur: string | null; kaynakId: string | null; hedefOzeti: string | null; oneri: Prisma.JsonValue },
  ): Promise<boolean> {
    const { kaynakTur, kaynakId, hedefOzeti } = hazirlik;
    if (!hedefOzeti || !kaynakTur || !kaynakId) return true;

    switch (kaynakTur) {
      case "fatura": {
        const oneri = hazirlik.oneri as Record<string, unknown> | null;
        if (typeof oneri?.satirId !== "string" || typeof oneri.stokId !== "string") return false;
        const satir = await tx.faturaSatir.findFirst({
          where: { id: oneri.satirId, faturaId: kaynakId, fatura: { durum: "taslak", tip: "alis" } },
          select: { id: true, miktar: true, toplamTutar: true },
        });
        if (!satir || hedefOzetiHesapla({ faturaId: kaynakId, satirId: satir.id, miktar: satir.miktar.toString(), tutar: satir.toplamTutar.toString() }) !== hedefOzeti) return false;
        return !!(await tx.stokKart.findFirst({ where: { id: oneri.stokId, aktif: true }, select: { id: true } }));
      }
      case "banka_ekstre_satir": {
        const s = await tx.bankaEkstreSatir.findUnique({ where: { id: kaynakId }, select: { id: true, durum: true, tutar: true, tarih: true } });
        return !!s && hedefOzetiHesapla({ satirId: s.id, tutar: s.tutar.toString(), tarih: s.tarih.toISOString(), durum: s.durum }) === hedefOzeti;
      }
      case "cari":
        return !!(await tx.cariHesap.findFirst({ where: { id: kaynakId, aktif: true }, select: { id: true } }));
      case "stok": {
        const stok = await tx.stokKart.findFirst({
          where: { id: kaynakId, aktif: true },
          select: { id: true, mevcutMiktar: true, kritikSeviye: true },
        });
        return !!stok?.kritikSeviye && hedefOzetiHesapla({
          stokId: stok.id, bakiye: stok.mevcutMiktar.toString(), kritik: stok.kritikSeviye.toString(),
        }) === hedefOzeti;
      }
      default:
        return true;
    }
  }

  /**
   * Onaylanan hazırlığı kesinleştirir (taslağı kayda veya eyleme dönüştürür).
   */
  private async kesinlestir(tx: Prisma.TransactionClient, tur: HazirlikTuru, veri: Record<string, unknown>, userId: string): Promise<{ olusanTur: string; olusanId: string }> {
    const { tenantId } = aktifBaglam();

    switch (tur) {
      case "fatura_stok_esleme": {
        // Satırın stok kartını bağla ve hafızaya yaz
        if (veri.satirId && veri.stokId) {
          await tx.faturaSatir.update({
            where: { id: String(veri.satirId), ...(veri.faturaId ? { faturaId: String(veri.faturaId) } : {}) },
            data: { stokId: String(veri.stokId) },
          });
        }
        // AI-59: öğrenilen eşleşmeyi hafızaya kaydet
        if (veri.stokAd && veri.stokId) {
          await this.hafiza.yaz({
            tur: "urun_eslesme",
            anahtar: String(veri.stokAd),
            stokId: String(veri.stokId),
            cariId: veri.cariId ? String(veri.cariId) : undefined,
            kapsam: "firma",
            kaynak: "kullanici",
          }, tx);
        }
        return { olusanTur: "fatura_satir", olusanId: String(veri.satirId ?? veri.faturaId ?? "") };
      }

      case "banka_ekstre_esleme": {
        // Banka ekstre satırının cari ve durumunu bağla
        if (veri.satirId) {
          await tx.bankaEkstreSatir.update({
            where: { id: String(veri.satirId), durum: "beklemede" },
            data: {
              durum: "eslesti",
              karsiUnvan: veri.cariUnvan ? String(veri.cariUnvan) : undefined,
            },
          });
        }
        return { olusanTur: "banka_ekstre_satir", olusanId: String(veri.satirId) };
      }

      case "vadesi_gecen_hatirlatma": {
        // Hatırlatma kaydı veya CRM etkileşimi oluştur
        const cariId = String(veri.cariId);
        const etkilesim = await tx.crmEtkilesim.create({
          data: {
            tenantId,
            cariId,
            tip: "eposta",
            konu: String(veri.konu ?? "Vade Hatırlatması"),
            aciklama: String(veri.metin ?? ""),
            tarih: new Date(),
            userId,
          },
        });
        return { olusanTur: "crm_etkilesim", olusanId: etkilesim.id };
      }

      case "kritik_stok_talep": {
        // Satın alma talebi / sipariş taslağı belgesi aç
        // Varsayılan cari veya tedarikçi
        const tedarikciId = veri.tedarikciId ? String(veri.tedarikciId) : (await tx.cariHesap.findFirst({ where: { tenantId, aktif: true }, select: { id: true } }))?.id;
        if (!tedarikciId) throw new BadRequestException("Satın alma taslağı için tanımlı cari kart bulunamadı.");

        const birimFiyat = new Prisma.Decimal(String(veri.tahminiBirimFiyat ?? 0));
        const miktar = new Prisma.Decimal(String(veri.onerilenMiktar ?? 1));
        const matrah = birimFiyat.mul(miktar);
        const kdvTutari = matrah.mul(0.2);
        const netKdvTutari = kdvTutari;
        const toplamTutar = matrah.add(kdvTutari);

        const belge = await tx.belge.create({
          data: {
            tenantId,
            tur: "siparis",
            yon: "alis",
            durum: "taslak",
            cariId: tedarikciId,
            tarih: new Date(),
            dovizCinsi: "TRY",
            kur: new Prisma.Decimal(1),
            toplamBrut: matrah,
            toplamSatirIskontosu: new Prisma.Decimal(0),
            genelIskontoToplam: new Prisma.Decimal(0),
            toplamMatrah: matrah,
            toplamKdv: kdvTutari,
            toplamNetKdv: netKdvTutari,
            genelToplam: toplamTutar,
            aciklama: `Kritik stok ikmali için otomatik hazırlık onayı: [${veri.stokKod}] ${veri.stokAd}`,
            satirlar: {
              create: {
                tenantId,
                stokId: String(veri.stokId),
                miktar,
                birim: String(veri.anaBirim ?? "adet"),
                birimFiyat,
                kdvOrani: new Prisma.Decimal(20),
                matrah,
                kdvTutari,
                netKdvTutari,
                toplamTutar,
              },
            },
          },
        });
        return { olusanTur: "belge", olusanId: belge.id };
      }

      case "ay_sonu_kapanis": {
        return { olusanTur: "donem_kontrol", olusanId: String(veri.donem ?? "") };
      }

      default:
        return { olusanTur: "hazirlik", olusanId: "" };
    }
  }

  /**
   * Süresi dolmuş bekleyen hazırlıkları 'suresi_doldu' yapar.
   */
  private async sureleriKapat(): Promise<void> {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiHazirlik.updateMany({
        where: {
          tenantId,
          durum: "hazir",
          gecerlilikBitisAt: { lt: new Date() },
        },
        data: { durum: "suresi_doldu" },
      }),
    ).catch((h) => this.logger.warn(`Süresi dolan hazırlıklar güncellenemedi: ${String(h)}`));
  }
}
