import { Controller, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe } from "@nestjs/common";
import { PlatformUcu } from "../auth/public.decorator";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";

@PlatformUcu()
@Controller("platform/firmalar")
export class PlatformKotaController {
  constructor(private readonly platform: PlatformPrismaService) {}
  @Get(":tenantId/ek-hacmi")
  async ekHacmi(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    const b = aktifPlatformBaglam();
    if (b.rol !== "yonetici") throw new ForbiddenException("Firma kullanım ölçümü için platform yöneticisi gerekir.");
    try {
      const [r] = await this.platform.db.$queryRaw<{ sonuc: unknown }[]>`SELECT platform_firma_ek_hacmi(${b.kullaniciId}::uuid,${tenantId}::uuid) AS sonuc`;
      return r.sonuc;
    } catch (e) {
      const m = (e as { meta?: { message?: string }; message?: string }).meta?.message ?? (e as Error).message ?? "";
      if (m.includes("kota_yetki")) throw new ForbiddenException("Aktif platform yöneticisi gerekir.");
      if (m.includes("kota_firma_yok")) throw new NotFoundException("Firma bulunamadı.");
      throw e;
    }
  }
}

@Module({ controllers: [PlatformKotaController] })
export class PlatformKotaModule {}
