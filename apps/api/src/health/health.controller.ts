import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
