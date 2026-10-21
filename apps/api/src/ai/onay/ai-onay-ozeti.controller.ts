import { Controller, Get } from "@nestjs/common";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";

/**
 * AI-83: kullanıcının onay bekleyen asistan talepleri (brifing ve araç).
 * Onay servisine bağlı değildir ki araç kaydı ile döngü oluşmasın.
 */
@Controller("ai/onay-ozeti")
export class AiOnayOzetiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async ozet() {
    const { tenantId, userId } = aktifBaglam();
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.findMany({
        where: { userId, durum: "bekliyor", gecerlilikSonu: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { ozet: true },
      }));
    return { bekleyen: talepler.length, ornekler: talepler.slice(0, 3).map((t) => t.ozet.split("\n")[0].slice(0, 140)) };
  }
}
