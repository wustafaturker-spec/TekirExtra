import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Baglanti } from "@prisma/client";
import {
  MockEntegratorAdapter,
  type EntegratorAdapter,
  type EntegratorConfig,
} from "@tekirextra/baglanti";
import { BAGLANTI_AILELERI, EBELGE_SAGLAYICILARI } from "@tekirextra/shared";
import { z } from "zod";
import { coz, sifrele } from "../core/kripto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

export const baglantiOlusturSemasi = z.object({
  aile: z.enum(BAGLANTI_AILELERI),
  saglayici: z.enum(EBELGE_SAGLAYICILARI),
  config: z.object({
    kullaniciAdi: z.string().min(1),
    parola: z.string().optional(),
    apiAnahtari: z.string().optional(),
    servisAdresi: z.string().optional(),
  }),
});

export interface BaglantiGorunumu {
  id: string;
  aile: string;
  saglayici: string;
  durum: string;
  /** Kimlik bilgileri asla dönmez; yalnızca maskeli kullanıcı adı (EBLG-01b). */
  kullaniciAdiMaskeli: string;
}

function maskele(deger: string): string {
  if (deger.length <= 3) return "***";
  return `${deger.slice(0, 3)}***`;
}

/**
 * Dış bağlantı yönetimi (ENT-01, EBLG-01a/01b). Gerçek entegratör hesapları
 * edinilene kadar tüm sağlayıcılar mock adaptöre çözümlenir (T-01).
 */
@Injectable()
export class BaglantilarService {
  constructor(private readonly prisma: PrismaService) {}

  adapterCoz(saglayici: string): EntegratorAdapter {
    // T-01: gerçek adaptörler geldikçe burada sağlayıcıya göre dallanılır
    return new MockEntegratorAdapter(
      saglayici as EntegratorConfig["saglayici"],
    );
  }

  async listele(): Promise<BaglantiGorunumu[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findMany({ orderBy: { createdAt: "asc" } }),
    );
    return kayitlar.map((k) => this.gorunum(k));
  }

  async olustur(girdi: z.infer<typeof baglantiOlusturSemasi>): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    if (girdi.aile !== "ebelge") {
      throw new BadRequestException(
        "v1.0'da yalnızca e-belge bağlantıları desteklenir (ENT-02..08 sonraki sürümde)",
      );
    }
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.baglanti.findFirst({
        where: { aile: "ebelge", saglayici: girdi.saglayici },
      });
      if (mevcut) {
        throw new BadRequestException(
          `'${girdi.saglayici}' entegratörü zaten tanımlı; güncellemek için düzenleyin.`,
        );
      }
      return tx.baglanti.create({
        data: {
          tenantId,
          aile: girdi.aile,
          saglayici: girdi.saglayici,
          sifreliConfig: sifrele(
            JSON.stringify({ saglayici: girdi.saglayici, ...girdi.config }),
          ),
        },
      });
    });
    return this.gorunum(kayit);
  }

  async guncelle(
    id: string,
    girdi: { config: z.infer<typeof baglantiOlusturSemasi>["config"] },
  ): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.baglanti.findUnique({ where: { id } });
      if (!mevcut) throw new NotFoundException("Bağlantı bulunamadı");

      return tx.baglanti.update({
        where: { id },
        data: {
          sifreliConfig: sifrele(
            JSON.stringify({ saglayici: mevcut.saglayici, ...girdi.config }),
          ),
          durum: "pasif",
        },
      });
    });
    return this.gorunum(kayit);
  }

  async aktifEt(id: string): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hedef = await tx.baglanti.findUnique({ where: { id } });
      if (!hedef) throw new NotFoundException("Bağlantı bulunamadı");

      // Aynı ailedeki diğer e-belge bağlantılarını pasife çek
      await tx.baglanti.updateMany({
        where: { tenantId, aile: "ebelge", id: { not: id } },
        data: { durum: "pasif" },
      });

      // Hedef bağlantıyı aktif yap
      return tx.baglanti.update({
        where: { id },
        data: { durum: "aktif" },
      });
    });
    return this.gorunum(kayit);
  }

  async test(id: string): Promise<{ basarili: boolean; mesaj?: string }> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Bağlantı bulunamadı");

    const config = JSON.parse(coz(kayit.sifreliConfig)) as EntegratorConfig;
    const sonuc = await this.adapterCoz(kayit.saglayici).baglantiTest(config);

    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.update({
        where: { id },
        data: { durum: sonuc.basarili ? "aktif" : "hata" },
      }),
    );
    return sonuc;
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.deleteMany({ where: { id } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Bağlantı bulunamadı");
  }

  private gorunum(k: Baglanti): BaglantiGorunumu {
    let kullaniciAdi = "";
    try {
      kullaniciAdi = (JSON.parse(coz(k.sifreliConfig)) as EntegratorConfig)
        .kullaniciAdi;
    } catch {
      kullaniciAdi = "";
    }
    return {
      id: k.id,
      aile: k.aile,
      saglayici: k.saglayici,
      durum: k.durum,
      kullaniciAdiMaskeli: maskele(kullaniciAdi),
    };
  }
}
