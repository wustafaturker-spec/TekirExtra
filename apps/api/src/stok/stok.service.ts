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
  kategoriSemasi,
  sayimOlusturSemasi,
  stokBirimSemasi,
  stokKartGuncelleSemasi,
  stokKartOlusturSemasi,
} from "./stok.semalar";

import { stokExcelOku } from "../core/excel-yardimci";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class StokService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── STOK KART YÖNETİMİ (STK-01) ───────────────────────────────────────────

  async listele(arama?: string, kategoriId?: string, imlec?: string, adet = 50) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();

    const where: Prisma.StokKartWhereInput = {
      ...(kategoriId ? { kategoriId } : {}),
      ...(arama
        ? {
            OR: [
              { ad: { contains: arama, mode: "insensitive" } },
              { kod: { contains: arama, mode: "insensitive" } },
              { barkod: { contains: arama, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where,
        orderBy: { kod: "asc" },
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        include: {
          kategori: { select: { id: true, ad: true } },
          _count: { select: { hareketler: true } },
        },
      }),
    );

    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet].id : null;
    const sayfa = kayitlar.slice(0, adet);

    return {
      kayitlar: sayfa.map((k) => ({
        ...this.gorunum(k),
        kategori: k.kategori,
        izinliEylemler: this.eylemler(k, ctx.rol, k._count.hareketler),
      })),
      sonrakiImlec,
    };
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.stokKart.findUnique({
        where: { id },
        include: {
          kategori: true,
          birimler: true,
          _count: { select: { hareketler: true } },
        },
      }),
    );

    if (!kayit) throw new NotFoundException("Stok kartı bulunamadı");

    return {
      ...this.gorunum(kayit),
      kategori: kayit.kategori,
      birimler: kayit.birimler,
      izinliEylemler: this.eylemler(kayit, ctx.rol, kayit._count.hareketler),
    };
  }

  async olustur(girdi: z.infer<typeof stokKartOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.create({
          data: {
            tenantId,
            kod: girdi.kod,
            ad: girdi.ad,
            tip: girdi.tip,
            barkod: girdi.barkod,
            kategoriId: girdi.kategoriId,
            anaBirim: girdi.anaBirim,
            kdvOrani: D(girdi.kdvOrani),
            alisFiyati: girdi.alisFiyati ? D(girdi.alisFiyati) : null,
            satisFiyati: girdi.satisFiyati ? D(girdi.satisFiyati) : null,
            kritikSeviye: girdi.kritikSeviye ? D(girdi.kritikSeviye) : null,
            gorselUrl: girdi.gorselUrl,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu ürün zaten kullanımda`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof stokKartGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(id);
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokKart.update({
          where: { id },
          data: {
            kod: girdi.kod,
            ad: girdi.ad,
            tip: girdi.tip,
            barkod: girdi.barkod,
            kategoriId: girdi.kategoriId,
            anaBirim: girdi.anaBirim,
            kdvOrani: girdi.kdvOrani ? D(girdi.kdvOrani) : undefined,
            alisFiyati: girdi.alisFiyati !== undefined ? (girdi.alisFiyati ? D(girdi.alisFiyati) : null) : undefined,
            satisFiyati: girdi.satisFiyati !== undefined ? (girdi.satisFiyati ? D(girdi.satisFiyati) : null) : undefined,
            kritikSeviye: girdi.kritikSeviye !== undefined ? (girdi.kritikSeviye ? D(girdi.kritikSeviye) : null) : undefined,
            gorselUrl: girdi.gorselUrl,
            aktif: girdi.aktif,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu ürün zaten kullanımda`);
      }
      throw hata;
    }
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokHareket.count({ where: { stokId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException(
        "Hareketi olan stok kartı silinemez; pasife alın (aktif=false)",
      );
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.delete({ where: { id } }),
    );
  }

  // ─── KATEGORİ YÖNETİMİ (STK-09) ──────────────────────────────────────────

  async kategoriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.findMany({
        orderBy: { ad: "asc" },
        include: { ust: { select: { id: true, ad: true } } },
      }),
    );
  }

  async kategoriOlustur(girdi: z.infer<typeof kategoriSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.create({
        data: {
          tenantId,
          ad: girdi.ad,
          ustId: girdi.ustId,
        },
      }),
    );
  }

  async kategoriSil(id: string) {
    const { tenantId } = aktifBaglam();
    // Alt kategorisi var mı?
    const altKategoriSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.count({ where: { ustId: id } }),
    );
    if (altKategoriSayisi > 0) {
      throw new BadRequestException("Alt kategorisi bulunan kategori silinemez");
    }
    // Bu kategoriye ait ürün var mı?
    const urunSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.count({ where: { kategoriId: id } }),
    );
    if (urunSayisi > 0) {
      throw new BadRequestException("Ürünleri bulunan kategori silinemez");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKategori.delete({ where: { id } }),
    );
  }

  // ─── ÇOKLU BİRİM YÖNETİMİ (STK-10) ───────────────────────────────────────

  async birimEkle(stokId: string, girdi: z.infer<typeof stokBirimSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.stokBirim.create({
          data: {
            tenantId,
            stokId,
            ad: girdi.ad,
            katsayi: D(girdi.katsayi),
          },
        }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(
          `Bu ürün için '${girdi.ad}' birimi zaten tanımlı`,
        );
      }
      throw hata;
    }
  }

  async birimSil(stokId: string, birimId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokBirim.delete({ where: { id: birimId, stokId } }),
    );
  }

  // ─── STOK HAREKETLERİ & AVCO HESAPLAMA (STK-02/08) ───────────────────────

  async hareketListele(stokId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(stokId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokHareket.findMany({
        where: { stokId },
        orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
      }),
    );
  }

  /**
   * Stok hareketi ekler ve ürünün mevcut miktar & ortalama maliyet (AVCO)
   * bilgisini transaction içinde günceller (STK-08).
   */
  async hareketEkle(
    tx: Prisma.TransactionClient,
    stokId: string,
    tip: "giris" | "cikis" | "sayim_duzeltme",
    miktar: Prisma.Decimal,
    girilenBirim: string,
    girilenMiktar: Prisma.Decimal,
    birimMaliyet: Prisma.Decimal,
    tarih: Date,
    aciklama?: string | null,
    kaynakTur = "manuel",
    kaynakRef?: string | null,
  ) {
    const { tenantId } = aktifBaglam();
    
    // Ürünü kilitleyerek getir (race condition engellemek için)
    const urun = await tx.stokKart.findUnique({
      where: { id: stokId },
    });
    if (!urun) throw new NotFoundException("Stok kartı bulunamadı");

    let miktarDegisimi = D(0);
    let yeniMevcut = D(urun.mevcutMiktar);
    let yeniMaliyet = D(urun.ortalamaMaliyet);

    if (tip === "giris") {
      miktarDegisimi = miktar;
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);

      // AVCO Formülü (STK-08):
      // yeniMevcut > 0 ise yeni maliyet hesaplanır. Eski mevcut miktar <= 0 ise,
      // yeni maliyet doğrudan gelen birimMaliyet olur (negatif stoku düzeltirken veya sıfır envanterde).
      if (yeniMevcut.gt(0)) {
        if (D(urun.mevcutMiktar).lte(0)) {
          yeniMaliyet = birimMaliyet;
        } else {
          const eskiDeger = D(urun.mevcutMiktar).mul(D(urun.ortalamaMaliyet));
          const girenDeger = miktar.mul(birimMaliyet);
          yeniMaliyet = eskiDeger.add(girenDeger).div(yeniMevcut).toDecimalPlaces(4);
        }
      }
    } else if (tip === "cikis") {
      miktarDegisimi = miktar.negated();
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);
      // Çıkış hareketinde maliyet, mevcut ortalama maliyettir ve ortalama maliyet DEĞİŞMEZ.
      birimMaliyet = D(urun.ortalamaMaliyet);
    } else if (tip === "sayim_duzeltme") {
      miktarDegisimi = miktar; // Sayım düzeltmesinde miktar pozitif veya negatif olabilir
      yeniMevcut = D(urun.mevcutMiktar).add(miktarDegisimi);

      // Artış düzeltmesi ise (miktar > 0), bir nevi giriş gibi maliyet etkilenir
      if (miktarDegisimi.gt(0)) {
        if (yeniMevcut.gt(0)) {
          if (D(urun.mevcutMiktar).lte(0)) {
            yeniMaliyet = birimMaliyet;
          } else {
            const eskiDeger = D(urun.mevcutMiktar).mul(D(urun.ortalamaMaliyet));
            const girenDeger = miktarDegisimi.mul(birimMaliyet);
            yeniMaliyet = eskiDeger.add(girenDeger).div(yeniMevcut).toDecimalPlaces(4);
          }
        }
      }
      // Azalış düzeltmesi ise (miktar < 0) maliyet değişmez, çıkış gibi işlem görür
    }

    // Stok hareketini yaz
    const hareket = await tx.stokHareket.create({
      data: {
        tenantId,
        stokId,
        tip,
        miktar: miktarDegisimi,
        girilenBirim,
        girilenMiktar,
        maliyet: birimMaliyet,
        tarih,
        aciklama,
        kaynakTur,
        kaynakRef,
      },
    });

    // Stok kartını güncelle
    await tx.stokKart.update({
      where: { id: stokId },
      data: {
        mevcutMiktar: yeniMevcut,
        ortalamaMaliyet: yeniMaliyet,
      },
    });

    return hareket;
  }

  // ─── FİİLİ SAYIM (STK-06) ────────────────────────────────────────────────

  async sayimOlustur(girdi: z.infer<typeof sayimOlusturSemasi>) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Sayım kaydını oluştur
      const sayim = await tx.sayim.create({
        data: {
          tenantId,
          tarih: new Date(girdi.tarih),
          aciklama: girdi.aciklama,
        },
      });

      // 2. Her bir sayım kalemi için stok kartını oku, farkı hesapla ve stok hareketi ekle
      for (const k of girdi.kalemler) {
        const urun = await tx.stokKart.findUnique({
          where: { id: k.stokId },
        });
        if (!urun) throw new NotFoundException(`Sayılmak istenen '${k.stokId}' ürünü bulunamadı`);

        const sistemMiktar = D(urun.mevcutMiktar);
        const fiiliMiktar = D(k.fiiliMiktar);
        const fark = fiiliMiktar.sub(sistemMiktar);

        // Sayım kalem detayını kaydet
        await tx.sayimKalem.create({
          data: {
            tenantId,
            sayimId: sayim.id,
            stokId: k.stokId,
            sistemMiktar,
            fiiliMiktar,
          },
        });

        // Fark varsa stok hareketini ve AVCO'yu tetikle
        if (!fark.isZero()) {
          // Eğer fazlalık varsa, maliyetlendirme için mevcut ortalama maliyet veya alış fiyatını baz al
          const birimMaliyet = sistemMiktar.gt(0)
            ? D(urun.ortalamaMaliyet)
            : D(urun.alisFiyati ?? 0);

          await this.hareketEkle(
            tx,
            k.stokId,
            "sayim_duzeltme",
            fark,
            urun.anaBirim,
            fark,
            birimMaliyet,
            new Date(girdi.tarih),
            `${sayim.id} nolu sayım düzeltmesi`,
            "sayim",
            sayim.id,
          );
        }
      }

      return sayim;
    });
  }

  async sayimListesi() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sayim.findMany({
        orderBy: { tarih: "desc" },
        include: { _count: { select: { kalemler: true } } },
      }),
    );
  }

  async sayimGetir(id: string) {
    const { tenantId } = aktifBaglam();
    const sayim = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.sayim.findUnique({
        where: { id },
        include: {
          kalemler: true,
        },
      }),
    );
    if (!sayim) throw new NotFoundException("Sayım bulunamadı");

    const stokIdler = sayim.kalemler.map((k) => k.stokId);
    const stoklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({
        where: { id: { in: stokIdler } },
        select: { id: true, kod: true, ad: true, anaBirim: true },
      }),
    );
    const stokMap = new Map(stoklar.map((s) => [s.id, s]));

    return {
      ...sayim,
      kalemler: sayim.kalemler.map((k) => ({
        ...k,
        stok: stokMap.get(k.stokId) ?? null,
      })),
    };
  }

  // Envanter raporu RPR-06 araç setine taşındı: stok.envanter (STK-13).

  // ─── PRIVATE YARDIMCILAR ──────────────────────────────────────────────────

  private eylemler(
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      "stok",
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }

  private gorunum(k: {
    id: string;
    kod: string;
    ad: string;
    tip: string;
    barkod: string | null;
    kategoriId: string | null;
    anaBirim: string;
    kdvOrani: Prisma.Decimal;
    alisFiyati: Prisma.Decimal | null;
    satisFiyati: Prisma.Decimal | null;
    kritikSeviye: Prisma.Decimal | null;
    gorselUrl: string | null;
    mevcutMiktar: Prisma.Decimal;
    ortalamaMaliyet: Prisma.Decimal;
    aktif: boolean;
  }) {
    return {
      id: k.id,
      kod: k.kod,
      ad: k.ad,
      tip: k.tip,
      barkod: k.barkod,
      kategoriId: k.kategoriId,
      anaBirim: k.anaBirim,
      kdvOrani: D(k.kdvOrani).toFixed(2),
      alisFiyati: k.alisFiyati ? D(k.alisFiyati).toFixed(4) : null,
      satisFiyati: k.satisFiyati ? D(k.satisFiyati).toFixed(4) : null,
      kritikSeviye: k.kritikSeviye ? D(k.kritikSeviye).toFixed(3) : null,
      gorselUrl: k.gorselUrl,
      mevcutMiktar: D(k.mevcutMiktar).toFixed(3),
      ortalamaMaliyet: D(k.ortalamaMaliyet).toFixed(4),
      aktif: k.aktif,
    };
  }

  async excelImport(buffer: Buffer): Promise<{ eklenen: number }> {
    const { tenantId } = aktifBaglam();
    const urunler = await stokExcelOku(buffer);

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      for (const u of urunler) {
        await tx.stokKart.upsert({
          where: { tenantId_kod: { tenantId, kod: u.kod } },
          create: {
            tenantId,
            kod: u.kod,
            ad: u.ad,
            tip: u.tip,
            barkod: u.barkod,
            kdvOrani: u.kdvOrani,
            alisFiyati: u.alisFiyati,
            satisFiyati: u.satisFiyati,
            mevcutMiktar: 0,
            ortalamaMaliyet: 0,
          },
          update: {
            ad: u.ad,
            tip: u.tip,
            barkod: u.barkod,
            kdvOrani: u.kdvOrani,
            alisFiyati: u.alisFiyati,
            satisFiyati: u.satisFiyati,
          },
        });
      }
    });

    return { eklenen: urunler.length };
  }
}
