import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "./depo.service";
import { StokService } from "./stok.service";
import type { transferOlusturSemasi } from "./depo.semalar";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

/**
 * Depolar arası transfer fişi (STK-07).
 *
 * Fiş taslak olarak kaydedilir; yalnız onayda stoğa dokunur ve kaynak depoda
 * `transfer_cikis`, hedef depoda `transfer_giris` hareketi yazılır. Ortalama
 * maliyet firma genelinde tek tutulduğu için (S-01) transfer maliyeti
 * değiştirmez: her iki ayak da kartın güncel ortalama maliyetiyle işlenir.
 * Muhasebeye ve cariye etkisi yoktur.
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stokService: StokService,
    private readonly depoService: DepoService,
  ) {}

  async listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.depoTransfer.findMany({
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        include: {
          kaynakDepo: { select: { id: true, kod: true, ad: true } },
          hedefDepo: { select: { id: true, kod: true, ad: true } },
          _count: { select: { kalemler: true } },
        },
      }),
    );
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const transfer = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.depoTransfer.findUnique({
        where: { id },
        include: {
          kaynakDepo: { select: { id: true, kod: true, ad: true } },
          hedefDepo: { select: { id: true, kod: true, ad: true } },
          kalemler: {
            include: {
              stok: { select: { id: true, kod: true, ad: true, anaBirim: true } },
            },
          },
        },
      }),
    );
    if (!transfer) throw new NotFoundException("Transfer fişi bulunamadı");
    return transfer;
  }

  async olustur(girdi: z.infer<typeof transferOlusturSemasi>) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kaynakDepoId = await this.depoService.depoCozumle(tx, girdi.kaynakDepoId);
      const hedefDepoId = await this.depoService.depoCozumle(tx, girdi.hedefDepoId);
      if (kaynakDepoId === hedefDepoId) {
        throw new BadRequestException("Kaynak ve hedef depo aynı olamaz");
      }

      const transfer = await tx.depoTransfer.create({
        data: {
          tenantId,
          no: await this.siradakiNo(tx, tenantId, new Date(girdi.tarih)),
          tarih: new Date(girdi.tarih),
          kaynakDepoId,
          hedefDepoId,
          aciklama: girdi.aciklama,
        },
      });

      for (const k of girdi.kalemler) {
        await this.stokService.varyantDogrula(tx, k.stokId, k.varyantId);
        const kart = await tx.stokKart.findUnique({
          where: { id: k.stokId },
          select: { id: true, ad: true, tip: true },
        });
        if (!kart) {
          throw new NotFoundException(`Transfer edilecek '${k.stokId}' ürünü bulunamadı`);
        }
        if (kart.tip === "hizmet") {
          throw new BadRequestException(
            `'${kart.ad}' bir hizmet kartı; depolar arası transfer edilemez`,
          );
        }
        const katsayi = await this.stokService.birimKatsayisi(tx, k.stokId, k.girilenBirim);
        await tx.depoTransferKalem.create({
          data: {
            tenantId,
            transferId: transfer.id,
            stokId: k.stokId,
            varyantId: k.varyantId,
            miktar: D(k.girilenMiktar).mul(katsayi),
            girilenBirim: k.girilenBirim,
            girilenMiktar: D(k.girilenMiktar),
          },
        });
      }

      return transfer;
    });
  }

  /**
   * Fişi onaylar: kaynak depoda çıkış, hedef depoda giriş hareketi yazılır.
   * Eksi stok politikası kaynak depo için işler (STK-17) — "uyar" modundaki
   * uyarılar onay yanıtında döner.
   */
  async onayla(id: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (!["muhasebe", "yonetici"].includes(rol)) {
      throw new ForbiddenException("Transfer onayı için muhasebe veya yönetici rolü gerekir");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const transfer = await tx.depoTransfer.findUnique({
        where: { id },
        include: { kalemler: true },
      });
      if (!transfer) throw new NotFoundException("Transfer fişi bulunamadı");
      if (transfer.durum !== "taslak") {
        throw new BadRequestException("Transfer fişi zaten onaylanmış");
      }
      if (transfer.kalemler.length === 0) {
        throw new BadRequestException("Kalemsiz transfer onaylanamaz");
      }

      const uyarilar: string[] = [];
      for (const k of transfer.kalemler) {
        const kart = await tx.stokKart.findUnique({
          where: { id: k.stokId },
          select: { ortalamaMaliyet: true },
        });
        if (!kart) continue;
        const maliyet = D(kart.ortalamaMaliyet);

        const cikis = await this.stokService.hareketEkle(tx, {
          stokId: k.stokId,
          varyantId: k.varyantId,
          depoId: transfer.kaynakDepoId,
          tip: "transfer_cikis",
          miktar: D(k.miktar),
          girilenBirim: k.girilenBirim,
          girilenMiktar: D(k.girilenMiktar),
          birimMaliyet: maliyet,
          tarih: new Date(transfer.tarih),
          aciklama: `${transfer.no} nolu depo transferi`,
          kaynakTur: "transfer",
          kaynakRef: transfer.id,
        });
        if (cikis.eksiStokUyarisi) uyarilar.push(cikis.eksiStokUyarisi);

        await this.stokService.hareketEkle(tx, {
          stokId: k.stokId,
          varyantId: k.varyantId,
          depoId: transfer.hedefDepoId,
          tip: "transfer_giris",
          miktar: D(k.miktar),
          girilenBirim: k.girilenBirim,
          girilenMiktar: D(k.girilenMiktar),
          birimMaliyet: maliyet,
          tarih: new Date(transfer.tarih),
          aciklama: `${transfer.no} nolu depo transferi`,
          kaynakTur: "transfer",
          kaynakRef: transfer.id,
          partiler: cikis.partiTahsisleri,
        });
      }

      const guncel = await tx.depoTransfer.update({
        where: { id },
        data: {
          durum: "onaylandi",
          onaylayanUserId: userId,
          onayZamani: new Date(),
        },
      });
      return { ...guncel, uyarilar };
    });
  }

  /** Yalnız taslak fiş silinebilir; onaylı fişin hareketleri değişmez kayıttır. */
  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const transfer = await tx.depoTransfer.findUnique({ where: { id } });
      if (!transfer) throw new NotFoundException("Transfer fişi bulunamadı");
      if (transfer.durum !== "taslak") {
        throw new BadRequestException("Onaylanmış transfer fişi silinemez");
      }
      await tx.depoTransfer.delete({ where: { id } });
    });
  }

  /** TRF-2026-000001 biçiminde yıl bazlı sıra (BelgeSayac deseni). */
  private async siradakiNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
    tarih: Date,
  ): Promise<string> {
    const yil = tarih.getFullYear();
    const sayac = await tx.transferSayac.upsert({
      where: { tenantId_yil: { tenantId, yil } },
      create: { tenantId, yil, sonSira: 1 },
      update: { sonSira: { increment: 1 } },
    });
    return `TRF-${yil}-${String(sayac.sonSira).padStart(6, "0")}`;
  }
}
