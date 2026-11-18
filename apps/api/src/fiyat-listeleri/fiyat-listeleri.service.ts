import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { OnayService } from "../onay/onay.service";
import { fiyatListesiTopluSemasi } from "./fiyat-listeleri.semalar";
import { fiyatListesiSurumu } from "./fiyat-listesi-surumu";
import { ozelRolIstegiKapali, paketApiYoluKapali } from "@tekirextra/shared";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { kurCoz } from "../doviz/kur-coz";
import { fiyatEndeksErisimi, tarafDenetle } from "../fiyat-endeks/fiyat-endeks-erisim";
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
  constructor(private readonly prisma: PrismaService, private readonly onay: OnayService) {
    this.onay.yurutucuKaydet("fiyat_listesi_guncelle", {
      yurut: (p, id) => this.topluKaydet(id!, fiyatListesiTopluSemasi.parse(p)),
      hedefOzeti: async (id) => this.surum(id),
    });
  }

  private async surum(id: string): Promise<string> {
    const liste = await this.prisma.tenantIslem(aktifBaglam().tenantId, (tx) => tx.fiyatListesi.findUnique({ where: { id }, include: { kalemler: true } }));
    if (!liste) throw new NotFoundException("Fiyat listesi bulunamadı");
    return fiyatListesiSurumu(liste);
  }

  /** Tek transaction: eski önizleme veya değişmiş hedef hiçbir kalemi yazamaz. */
  async topluKaydet(listeId: string, g: z.infer<typeof fiyatListesiTopluSemasi>): Promise<{ id: string; adet: number }> {
    const b = aktifBaglam();
    const yol = `fiyat-listeleri/${listeId}/toplu-fiyat`;
    const erisim = new AbonelikErisimService(this.prisma);
    if (b.destek || !["yonetici", "muhasebe"].includes(b.rol)
      || ozelRolIstegiKapali(b.ozelRol?.kapali ?? [], "POST", yol)
      || paketApiYoluKapali(await erisim.modulleriGetir(b.tenantId), yol)
      || (await erisim.getir(b.tenantId)).kisitli) throw new ForbiddenException("Fiyat güncelleme yetkiniz yok.");
    if (g.kaynak === "endeks") await this.prisma.tenantIslem(b.tenantId, async (tx) => {
      tarafDenetle(await fiyatEndeksErisimi(tx, b.tenantId, b.rol), "satis");
    });
    if (await this.surum(listeId) !== g.surum) throw new ConflictException("Fiyat listesi değişti; öneriyi yeniden önizleyin.");
    const liste = await this.mevcut(listeId);
    await this.onay.kapi({
      islem: "fiyat_listesi_guncelle", hedefTur: "fiyat_listesi", hedefId: listeId,
      ozet: `${liste.ad} · ${g.kalemler.length} kalem${g.yeniAd ? ` · yeni pasif liste: ${g.yeniAd}` : ""}`,
      parametreler: g,
      olc: async () => {
        const kur = liste.dovizCinsi === "TRY" ? D(1) : await this.prisma.tenantIslem(b.tenantId, (tx) => kurCoz(tx, b.tenantId, liste.dovizCinsi, new Date(), "alis"));
        if (!kur) throw new BadRequestException("Onay eşiği için döviz kuru bulunamadı.");
        return { tutarTry: Number(g.kalemler.reduce((t, k) => t.add(k.fiyat), D(0)).mul(kur)), hedefOzeti: g.surum };
      },
    });
    return this.prisma.tenantIslem(b.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM fiyat_listeleri WHERE id = ${listeId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM fiyat_listesi_kalemleri WHERE liste_id = ${listeId}::uuid ORDER BY id FOR UPDATE`;
      const hedef = await tx.fiyatListesi.findUnique({ where: { id: listeId }, include: { kalemler: true } });
      if (!hedef || fiyatListesiSurumu(hedef) !== g.surum) throw new ConflictException("Fiyat listesi değişti; işlem yapılmadı.");
      if (await tx.stokKart.count({ where: { id: { in: g.kalemler.map((k) => k.stokId) } } }) !== g.kalemler.length) throw new BadRequestException("Ürün bulunamadı.");
      const id = g.yeniAd ? (await tx.fiyatListesi.create({ data: { tenantId: b.tenantId, ad: g.yeniAd, dovizCinsi: hedef.dovizCinsi, aktif: false } })).id : listeId;
      for (const k of g.kalemler) await tx.fiyatListesiKalem.upsert({
        where: { tenantId_listeId_stokId: { tenantId: b.tenantId, listeId: id, stokId: k.stokId } },
        create: { tenantId: b.tenantId, listeId: id, stokId: k.stokId, fiyat: D(k.fiyat) }, update: { fiyat: D(k.fiyat) },
      });
      await tx.auditLog.create({ data: { tenantId: b.tenantId, userId: b.userId, islem: "fiyat_listesi_toplu_guncellendi", varlik: "fiyat_listesi", varlikId: id, detay: { kaynakListeId: listeId, adet: g.kalemler.length, surum: g.surum } } });
      return { id, adet: g.kalemler.length };
    }, { timeout: 60_000 });
  }

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

    await this.topluKaydet(listeId, { surum: await this.surum(listeId), kalemler: [girdi] });
    const kalem = await this.prisma.tenantIslem(tenantId, (tx) => tx.fiyatListesiKalem.findUniqueOrThrow({
      where: { tenantId_listeId_stokId: { tenantId, listeId, stokId: girdi.stokId } },
    }));

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
