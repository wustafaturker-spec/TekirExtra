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
  baglantiOlusturSemasi,
} from "./baglantilar.service";
import { KayitService, kayitSemasi } from "./kayit.service";

const firmaGuncelleSemasi = z.object({
  unvan: z.string().min(2).max(255).optional(),
  vergiDairesi: z.string().min(2).max(120).optional(),
});

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
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, unvan: true, vkn: true, vergiDairesi: true },
      }),
    );
  }

  @Patch("firma")
  @Roller("yonetici")
  async firmaGuncelle(@Body() govde: unknown) {
    const ayristirma = firmaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz firma bilgisi");
    }
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: ayristirma.data,
        select: { id: true, unvan: true, vkn: true, vergiDairesi: true },
      }),
    );
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
    const ayristirma = z.object({ config: baglantiOlusturSemasi.shape.config }).safeParse(govde);
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
