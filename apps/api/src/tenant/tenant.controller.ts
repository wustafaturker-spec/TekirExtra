import { firmaEbelgeEksikleri } from "@tekirextra/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import {
  BaglantilarService,
  baglantiGuncelleSemasi,
  baglantiOlusturSemasi,
} from "./baglantilar.service";
import { KayitService, kayitSemasi } from "./kayit.service";

/** Boş metin "sil" demektir; alan null olarak kaydedilir. */
const serbestMetin = (sinir: number) => z.string().trim().max(sinir).transform((d) => d || null).nullable().optional();

const firmaGuncelleSemasi = z.object({
  unvan: z.string().min(2).max(255).optional(),
  vergiDairesi: z.string().min(2).max(120).optional(),
  // EBLG-62: e-belgenin satıcı tarafına ve PDF'lere yazılan bilgiler.
  adres: serbestMetin(300),
  ilce: serbestMetin(80),
  il: serbestMetin(80),
  postaKodu: serbestMetin(10),
  telefon: serbestMetin(30),
  eposta: z.union([z.string().trim().email("Geçerli bir e-posta girin"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  webSitesi: serbestMetin(200),
  mersisNo: z.union([z.string().trim().regex(/^\d{16}$/, "MERSİS numarası 16 hanedir"), z.literal("")]).transform((d) => d || null).nullable().optional(),
  ticaretSicilNo: serbestMetin(30),
});

/** Firma ekranının okuduğu alanlar; e-belge eksikleri de bununla hesaplanır. */
const FIRMA_ALANLARI = {
  id: true, unvan: true, vkn: true, vergiDairesi: true,
  adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true,
  abonelik: { select: { planKodu: true, durum: true, faturaEpostasi: true, donemBaslangici: true, donemSonu: true } },
} as const;

@Controller()
export class TenantController {
  constructor(
    private readonly kayit: KayitService,
    private readonly baglantilar: BaglantilarService,
    private readonly prisma: PrismaService,
  ) {}

  /** Self-servis firma kaydı (KLN-07) — kimliksiz erişilir. */
  @Public()
  @Post("tenant/kayit")
  async firmaKaydi(@Body() govde: unknown) {
    const ayristirma = kayitSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    const sonuc = await this.kayit.kaydet(ayristirma.data);
    return {
      ...sonuc,
      mesaj: "Kayıt alındı; doğrulama e-postanızı kontrol edin",
    };
  }

  @Get("firma")
  async firma() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: FIRMA_ALANLARI,
      });
      if (!tenant) return null;

      const logo = await tx.ek.findFirst({
        where: { sahipTur: "firma", sahipId: tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true, dosyaAdi: true, mimeTip: true, boyut: true },
      });

      // EBLG-62: e-belge gönderimini durduracak eksikler ekranda gösterilir.
      return {
        ...tenant,
        logo,
        ebelgeEksikleri: firmaEbelgeEksikleri(tenant),
      };
    });
  }

  @Patch("firma")
  @Roller("yonetici")
  async firmaGuncelle(@Body() govde: unknown) {
    const ayristirma = firmaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(ayristirma.error.issues.map((s) => s.message).join("; ") || "Geçersiz firma bilgisi");
    }
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: ayristirma.data,
        select: FIRMA_ALANLARI,
      });

      const logo = await tx.ek.findFirst({
        where: { sahipTur: "firma", sahipId: tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true, dosyaAdi: true, mimeTip: true, boyut: true },
      });

      // EBLG-62: e-belge gönderimini durduracak eksikler ekranda gösterilir.
      return {
        ...tenant,
        logo,
        ebelgeEksikleri: firmaEbelgeEksikleri(tenant),
      };
    });
  }

  @Get("baglantilar")
  @Roller("yonetici")
  baglantiListesi() {
    return this.baglantilar.listele();
  }

  @Post("baglantilar")
  @Roller("yonetici")
  baglantiOlustur(@Body() govde: unknown) {
    const ayristirma = baglantiOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz bağlantı bilgisi");
    }
    return this.baglantilar.olustur(ayristirma.data);
  }

  @Post("baglantilar/:id/test")
  @Roller("yonetici")
  @HttpCode(200)
  baglantiTest(@Param("id") id: string) {
    return this.baglantilar.test(id);
  }

  @Patch("baglantilar/:id")
  @Roller("yonetici")
  baglantiGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = baglantiGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz bağlantı bilgisi");
    }
    return this.baglantilar.guncelle(id, ayristirma.data);
  }

  @Post("baglantilar/:id/aktif-et")
  @Roller("yonetici")
  baglantiAktifEt(@Param("id") id: string) {
    return this.baglantilar.aktifEt(id);
  }

  @Delete("baglantilar/:id")
  @Roller("yonetici")
  async baglantiSil(@Param("id") id: string) {
    await this.baglantilar.sil(id);
    return { durum: "ok" };
  }
}
