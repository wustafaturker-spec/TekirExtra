import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type {
  fiyatListesiGuncelleSemasi,
  fiyatListesiKalemSemasi,
  fiyatListesiOlusturSemasi,
} from "./fiyat-listeleri.semalar";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

/**
 * Fiyat Listeleri (STK-11): çoklu fiyat listesi tanımlama ve kalem yönetimi.
 * Fatura kesiminde cari fiyat listesi otomatik uygulanır — tüketim tarafı
 * StokService.tavsiyeFiyat içindedir (FTR-14).
 */
@Injectable()
export class FiyatListeleriService {
  constructor(private readonly prisma: PrismaService) {}

  async listele() {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesi.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { kalemler: true, cariler: true } } },
      }),
    );
    return kayitlar.map((k) => ({
      id: k.id,
      ad: k.ad,
      dovizCinsi: k.dovizCinsi,
      aktif: k.aktif,
      kalemSayisi: k._count.kalemler,
      cariSayisi: k._count.cariler,
    }));
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesi.findUnique({
        where: { id },
        include: {
          kalemler: {
            include: {
              stok: { select: { id: true, kod: true, ad: true, anaBirim: true } },
            },
            orderBy: { stok: { ad: "asc" } },
          },
          _count: { select: { cariler: true } },
        },
      }),
    );
    if (!kayit) throw new NotFoundException("Fiyat listesi bulunamadı");
    return {
      id: kayit.id,
      ad: kayit.ad,
      dovizCinsi: kayit.dovizCinsi,
      aktif: kayit.aktif,
      cariSayisi: kayit._count.cariler,
      kalemler: kayit.kalemler.map((kl) => ({
        id: kl.id,
        stokId: kl.stokId,
        kod: kl.stok.kod,
        ad: kl.stok.ad,
        anaBirim: kl.stok.anaBirim,
        fiyat: kl.fiyat.toFixed(4),
      })),
    };
  }

  async olustur(girdi: z.infer<typeof fiyatListesiOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.fiyatListesi.create({
          data: {
            tenantId,
            ad: girdi.ad,
            dovizCinsi: girdi.dovizCinsi,
            aktif: girdi.aktif ?? true,
          },
        }),
      );
      return {
        id: kayit.id,
        ad: kayit.ad,
        dovizCinsi: kayit.dovizCinsi,
        aktif: kayit.aktif,
        kalemSayisi: 0,
        cariSayisi: 0,
      };
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.ad}' adlı fiyat listesi zaten var`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof fiyatListesiGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.mevcut(id);
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.fiyatListesi.update({ where: { id }, data: girdi }),
      );
      return {
        id: kayit.id,
        ad: kayit.ad,
        dovizCinsi: kayit.dovizCinsi,
        aktif: kayit.aktif,
      };
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.ad}' adlı fiyat listesi zaten var`);
      }
      throw hata;
    }
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    await this.mevcut(id);
    // Kalemler cascade ile silinir; carilerdeki referans (opsiyonel FK) null'lanır.
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesi.delete({ where: { id } }),
    );
  }

  /** Kalem ekle veya fiyat güncelle (aynı liste+stok için tek kayıt). */
  async kalemKaydet(
    listeId: string,
    girdi: z.infer<typeof fiyatListesiKalemSemasi>,
  ) {
    const { tenantId } = aktifBaglam();
    await this.mevcut(listeId);

    const stok = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findUnique({ where: { id: girdi.stokId } }),
    );
    if (!stok) throw new NotFoundException("Stok kartı bulunamadı");

    const kalem = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesiKalem.upsert({
        where: {
          tenantId_listeId_stokId: { tenantId, listeId, stokId: girdi.stokId },
        },
        update: { fiyat: D(girdi.fiyat) },
        create: {
          tenantId,
          listeId,
          stokId: girdi.stokId,
          fiyat: D(girdi.fiyat),
        },
      }),
    );

    return {
      id: kalem.id,
      stokId: kalem.stokId,
      kod: stok.kod,
      ad: stok.ad,
      anaBirim: stok.anaBirim,
      fiyat: kalem.fiyat.toFixed(4),
    };
  }

  async kalemSil(listeId: string, kalemId: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesiKalem.deleteMany({ where: { id: kalemId, listeId } }),
    );
    if (sonuc.count === 0) throw new NotFoundException("Kalem bulunamadı");
  }

  private async mevcut(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.fiyatListesi.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Fiyat listesi bulunamadı");
    return kayit;
  }
}
