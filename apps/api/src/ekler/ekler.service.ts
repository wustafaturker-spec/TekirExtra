import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { EkSahipTur, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DepoService } from "./depo.service";
import { dosyaIceriginiDogrula } from "../core/guvenlik/dosya-dogrulama";

/** Belge/dosya ekleri ortak altyapısı (4. aşama S-01). */

const MAKS_BOYUT = 10 * 1024 * 1024; // 10 MB

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

  /** AI-79: sohbet eki başka kullanıcıya (yöneticiye de) açılmaz. */
  private async sohbetEkiYetkisiDogrula(sahipTur: EkSahipTur, sahipId: string): Promise<void> {
    if (sahipTur !== "ai_sohbet") return;
    const { tenantId, userId } = aktifBaglam();
    const oturum = await this.prisma.tenantIslem(tenantId, (tx) => tx.ajanOturumu.findFirst({ where: { id: sahipId, userId }, select: { id: true } }));
    if (!oturum) throw new NotFoundException("Ek bulunamadı");
  }

  private personelBelgesiYetkisiDogrula(sahipTur: EkSahipTur): void {
    const { rol } = aktifBaglam();
    if (sahipTur === "personel" && rol !== "muhasebe" && rol !== "yonetici") {
      throw new ForbiddenException("Özlük belgelerine erişim yetkiniz bulunmuyor");
    }
  }

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
      firma_kase: () => tx.tenant.findUnique({ where: { id: sahipId } }),
      masraf: () => tx.masraf.findUnique({ where: { id: sahipId } }),
      kira_sozlesme: () => tx.kiraSozlesme.findUnique({ where: { id: sahipId } }),
      personel: () => tx.personel.findUnique({ where: { id: sahipId } }),
      satin_alma_teklif: () => tx.satinAlmaTeklifi.findUnique({ where: { id: sahipId } }),
      cek_senet: () => tx.cekSenet.findUnique({ where: { id: sahipId } }),
      demirbas: () => tx.demirbas.findUnique({ where: { id: sahipId } }),
      // AI-79: sohbet eki yalnız kendi sohbetine bağlanır.
      ai_sohbet: () => tx.ajanOturumu.findFirst({ where: { id: sahipId, userId: aktifBaglam().userId } }),
    }[sahipTur];
    if (!(await sorgu())) {
      throw new NotFoundException("Ekin bağlanacağı kayıt bulunamadı");
    }
  }

  async yukle(sahipTur: EkSahipTur, sahipId: string, dosya: YuklenenDosya) {
    if (dosya.size > MAKS_BOYUT) {
      throw new BadRequestException("Dosya 10 MB sınırını aşıyor");
    }
    // Çek/senet görüntüsü yalnız görüntü ya da PDF olabilir; saklanan MIME içerikten gelir.
    const mime = await dosyaIceriginiDogrula(dosya, sahipTur === "cek_senet" ? "goruntu" : sahipTur === "ai_sohbet" ? "sohbet" : "belge");
    const { tenantId, userId } = aktifBaglam();
    const guvenliAd = dosya.originalname.replace(/[^\w.\-çğıöşüÇĞİÖŞÜ ]/g, "_");
    const depoAnahtari = `${tenantId}/${sahipTur}/${sahipId}/${randomUUID()}-${guvenliAd}`;

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.sahipDogrula(tx, sahipTur, sahipId);
      // Önce depoya yaz: DB kaydı başarısızsa artık nesne sahipsiz kalır ama
      // veri kaybolmaz; ters sırada meta veri gövdesiz kalırdı.
      await this.depo.yukle(depoAnahtari, dosya.buffer, mime);
      return tx.ek.create({
        data: {
          tenantId,
          sahipTur,
          sahipId,
          dosyaAdi: dosya.originalname,
          mimeTip: mime,
          boyut: dosya.size,
          depoAnahtari,
          yukleyenUserId: userId,
        },
      });
    });
  }

  async listele(sahipTur: EkSahipTur, sahipId: string) {
    this.personelBelgesiYetkisiDogrula(sahipTur);
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
    this.personelBelgesiYetkisiDogrula(ek.sahipTur);
    await this.sohbetEkiYetkisiDogrula(ek.sahipTur, ek.sahipId);
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
