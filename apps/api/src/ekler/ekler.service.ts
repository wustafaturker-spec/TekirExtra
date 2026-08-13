import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { EkSahipTur, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "./depo.service";

/** Belge/dosya ekleri ortak altyapısı (4. aşama S-01). */

const MAKS_BOYUT = 10 * 1024 * 1024; // 10 MB

const IZINLI_MIMELER = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/xml",
  "text/xml",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export interface YuklenenDosya {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class EklerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
  ) {}

  /** Sahip kaydın bu kiracıda var olduğunu doğrular (RLS kapsamında). */
  private async sahipDogrula(
    tx: Prisma.TransactionClient,
    sahipTur: EkSahipTur,
    sahipId: string,
  ): Promise<void> {
    const sorgu = {
      cari: () => tx.cariHesap.findUnique({ where: { id: sahipId } }),
      stok: () => tx.stokKart.findUnique({ where: { id: sahipId } }),
      fatura: () => tx.fatura.findUnique({ where: { id: sahipId } }),
      belge: () => tx.belge.findUnique({ where: { id: sahipId } }),
      kasa_banka: () =>
        tx.kasaBankaHareket.findUnique({ where: { id: sahipId } }),
      firma: () => tx.tenant.findUnique({ where: { id: sahipId } }),
      masraf: () => tx.masraf.findUnique({ where: { id: sahipId } }),
      kira_sozlesme: () => tx.kiraSozlesme.findUnique({ where: { id: sahipId } }),
    }[sahipTur];
    if (!(await sorgu())) {
      throw new NotFoundException("Ekin bağlanacağı kayıt bulunamadı");
    }
  }

  async yukle(sahipTur: EkSahipTur, sahipId: string, dosya: YuklenenDosya) {
    if (dosya.size > MAKS_BOYUT) {
      throw new BadRequestException("Dosya 10 MB sınırını aşıyor");
    }
    if (!IZINLI_MIMELER.has(dosya.mimetype)) {
      throw new BadRequestException(
        `'${dosya.mimetype}' türü desteklenmiyor (PDF, görsel, Office ve metin dosyaları yüklenebilir)`,
      );
    }
    const { tenantId, userId } = aktifBaglam();
    const guvenliAd = dosya.originalname.replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]/g, "_");
    const depoAnahtari = `${tenantId}/${sahipTur}/${sahipId}/${randomUUID()}-${guvenliAd}`;

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.sahipDogrula(tx, sahipTur, sahipId);
      // Önce depoya yaz: DB kaydı başarısızsa artık nesne sahipsiz kalır ama
      // veri kaybolmaz; ters sırada meta veri gövdesiz kalırdı.
      await this.depo.yukle(depoAnahtari, dosya.buffer, dosya.mimetype);
      return tx.ek.create({
        data: {
          tenantId,
          sahipTur,
          sahipId,
          dosyaAdi: dosya.originalname,
          mimeTip: dosya.mimetype,
          boyut: dosya.size,
          depoAnahtari,
          yukleyenUserId: userId,
        },
      });
    });
  }

  async listele(sahipTur: EkSahipTur, sahipId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findMany({
        where: { sahipTur, sahipId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          dosyaAdi: true,
          mimeTip: true,
          boyut: true,
          yukleyenUserId: true,
          createdAt: true,
        },
      }),
    );
  }

  async indir(id: string) {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findUnique({ where: { id } }),
    );
    if (!ek) throw new NotFoundException("Ek bulunamadı");
    const icerik = await this.depo.indir(ek.depoAnahtari);
    return { ek, icerik };
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const ek = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.ek.findUnique({ where: { id } });
      if (!kayit) throw new NotFoundException("Ek bulunamadı");
      await tx.ek.delete({ where: { id } });
      return kayit;
    });
    // Depo silimi DB işlemi dışında: başarısız olursa nesne sahipsiz kalır,
    // meta veri tutarlılığı bozulmaz.
    await this.depo.sil(ek.depoAnahtari);
  }
}
