import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../core/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Konteyner/yük dengeleyici sağlık yoklaması — kimlik doğrulama istemez (NFR-14). */
  @Public()
  @Get()
  async health(): Promise<{ durum: string; veritabani: string; zaman: string }> {
    let veritabani = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      veritabani = "erisilemiyor";
    }
    return {
      durum: "ok",
      veritabani,
      zaman: new Date().toISOString(),
    };
  }
}
