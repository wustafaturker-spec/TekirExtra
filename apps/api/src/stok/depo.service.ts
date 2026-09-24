import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { depoGuncelleSemasi, depoOlusturSemasi } from "./depo.semalar";

/**
 * Depo yönetimi (STK-07).
 *
 * Kiracıda her zaman en az bir depo bulunur ve tam olarak biri varsayılandır;
 * depo seçmeyen akışlar (ve tek depolu firmalarda arayüz) varsayılanı kullanır.
 */
@Injectable()
export class DepoService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(yalnizAktif = false) {
    const { tenantId } = aktifBaglam();
    const depolar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.depo.findMany({
        where: yalnizAktif ? { aktif: true } : {},
        orderBy: [{ varsayilan: "desc" }, { kod: "asc" }],
        include: {
          _count: { select: { hareketler: true, bakiyeler: true } },
        },
      }),
    );
    return depolar.map((d) => ({
      id: d.id,
      kod: d.kod,
      ad: d.ad,
      adres: d.adres,
      il: d.il,
      ilce: d.ilce,
      postaKodu: d.postaKodu,
      sorumlu: d.sorumlu,
      varsayilan: d.varsayilan,
      aktif: d.aktif,
      hareketSayisi: d._count.hareketler,
      // Hareket görmüş depo silinemez (stok kartı politikasıyla aynı kural)
      silinebilir: d._count.hareketler === 0 && !d.varsayilan,
    }));
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const depo = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.depo.findUnique({ where: { id } }),
    );
    if (!depo) throw new NotFoundException("Depo bulunamadı");
    return depo;
  }

  async olustur(girdi: z.infer<typeof depoOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        if (girdi.varsayilan) {
          await tx.depo.updateMany({ data: { varsayilan: false } });
        }
        return tx.depo.create({
          data: {
            tenantId,
            kod: girdi.kod,
            ad: girdi.ad,
            adres: girdi.adres,
            il: girdi.il,
            ilce: girdi.ilce,
            postaKodu: girdi.postaKodu,
            sorumlu: girdi.sorumlu,
            varsayilan: girdi.varsayilan,
          },
        });
      });
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu depo zaten var`);
      }
      throw hata;
    }
  }

  async guncelle(id: string, girdi: z.infer<typeof depoGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.getir(id);

    if (girdi.varsayilan === false && mevcut.varsayilan) {
      throw new BadRequestException(
        "Varsayılan depo doğrudan kaldırılamaz; başka bir depoyu varsayılan yapın",
      );
    }
    if (girdi.aktif === false && mevcut.varsayilan) {
      throw new BadRequestException("Varsayılan depo pasife alınamaz");
    }

    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        if (girdi.varsayilan) {
          await tx.depo.updateMany({ data: { varsayilan: false } });
        }
        return tx.depo.update({
          where: { id },
          data: {
            ...(girdi.kod !== undefined ? { kod: girdi.kod } : {}),
            ...(girdi.ad !== undefined ? { ad: girdi.ad } : {}),
            ...(girdi.adres !== undefined ? { adres: girdi.adres } : {}),
            ...(girdi.il !== undefined ? { il: girdi.il } : {}),
            ...(girdi.ilce !== undefined ? { ilce: girdi.ilce } : {}),
            ...(girdi.postaKodu !== undefined ? { postaKodu: girdi.postaKodu } : {}),
            ...(girdi.sorumlu !== undefined ? { sorumlu: girdi.sorumlu } : {}),
            ...(girdi.varsayilan !== undefined ? { varsayilan: girdi.varsayilan } : {}),
            ...(girdi.aktif !== undefined ? { aktif: girdi.aktif } : {}),
          },
        });
      });
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodlu depo zaten var`);
      }
      throw hata;
    }
  }

  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    const depo = await this.getir(id);
    if (depo.varsayilan) {
      throw new BadRequestException("Varsayılan depo silinemez");
    }
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareketSayisi = await tx.stokHareket.count({ where: { depoId: id } });
      if (hareketSayisi > 0) {
        throw new BadRequestException(
          "Hareket görmüş depo silinemez; pasife alabilirsiniz",
        );
      }
      // Bakiye satırları yalnız sıfır miktarlıysa kalabilir
      const doluBakiye = await tx.stokDepoBakiye.count({
        where: { depoId: id, NOT: { mevcutMiktar: 0 } },
      });
      if (doluBakiye > 0) {
        throw new BadRequestException("Deposunda stok bulunan depo silinemez");
      }
      await tx.stokDepoBakiye.deleteMany({ where: { depoId: id } });
      await tx.depo.delete({ where: { id } });
    });
  }

  /**
   * Deponun tüm stok bakiyeleri (sayım ekranı ve depo detayı için).
   * Bakiye satırı olmayan ürünler listelenmez — miktarları sıfırdır.
   */
  async bakiyeler(depoId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(depoId);
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokDepoBakiye.findMany({
        where: { depoId },
        include: {
          stok: { select: { id: true, kod: true, ad: true, tip: true, anaBirim: true } },
        },
      }),
    );
    return satirlar
      .sort((a, b) => a.stok.kod.localeCompare(b.stok.kod, "tr"))
      .map((s) => ({
        stokId: s.stokId,
        kod: s.stok.kod,
        ad: s.stok.ad,
        tip: s.stok.tip,
        anaBirim: s.stok.anaBirim,
        mevcutMiktar: new Prisma.Decimal(s.mevcutMiktar).toFixed(3),
        rezerveMiktar: new Prisma.Decimal(s.rezerveMiktar).toFixed(3),
        yoldakiMiktar: new Prisma.Decimal(s.yoldakiMiktar).toFixed(3),
      }));
  }

  // ─── AKIŞLARIN KULLANDIĞI YARDIMCILAR ────────────────────────────────────

  /** Kiracının varsayılan deposu; yoksa (beklenmez) ilk aktif depo. */
  async varsayilanDepo(tx: Prisma.TransactionClient) {
    const depo =
      (await tx.depo.findFirst({ where: { varsayilan: true } })) ??
      (await tx.depo.findFirst({ where: { aktif: true }, orderBy: { kod: "asc" } }));
    if (!depo) {
      throw new BadRequestException(
        "Firmada tanımlı depo yok; Ayarlar > Depolar ekranından bir depo ekleyin",
      );
    }
    return depo;
  }

  /**
   * Verilen depo kimliğini doğrular; boşsa varsayılan depoyu döner.
   * Depo seçimi olmayan (tek depolu) akışlar bu yolla depoya bağlanır.
   */
  async depoCozumle(
    tx: Prisma.TransactionClient,
    depoId?: string | null,
  ): Promise<string> {
    if (!depoId) return (await this.varsayilanDepo(tx)).id;
    const depo = await tx.depo.findUnique({ where: { id: depoId } });
    if (!depo) throw new NotFoundException("Depo bulunamadı");
    if (!depo.aktif) {
      throw new BadRequestException(`'${depo.ad}' pasif bir depo`);
    }
    return depo.id;
  }

  /**
   * Depo bakiyesinin bir alanını artırır/azaltır (satır yoksa açar).
   * mevcutMiktar StokService.hareketEkle üzerinden yürür; bu yardımcı
   * rezerve/yoldaki için kullanılır (FTR-12).
   */
  async bakiyeDegistir(
    tx: Prisma.TransactionClient,
    stokId: string,
    depoId: string,
    alan: "rezerveMiktar" | "yoldakiMiktar",
    delta: Prisma.Decimal,
  ): Promise<void> {
    const { tenantId } = aktifBaglam();
    await tx.stokDepoBakiye.upsert({
      where: { tenantId_stokId_depoId: { tenantId, stokId, depoId } },
      create: { tenantId, stokId, depoId, [alan]: delta },
      update: { [alan]: { increment: delta } },
    });
  }
}
