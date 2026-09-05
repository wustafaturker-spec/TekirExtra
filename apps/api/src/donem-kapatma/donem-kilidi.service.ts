import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class DonemKilidiService {
  constructor(private readonly prisma: PrismaService) {}

  async tarihDogrula(tenantId: string, tarih: Date | string, islem: string): Promise<void> {
    const deger = tarih instanceof Date ? tarih : new Date(tarih);
    const kilit = await this.prisma.tenantIslem(tenantId, (tx) => tx.maliDonem.findUnique({
      where: { tenantId_yil_ay: { tenantId, yil: deger.getFullYear(), ay: deger.getMonth() + 1 } }, select: { durum: true },
    }));
    if (kilit?.durum === "kapali") throw new ConflictException(`${deger.toLocaleDateString("tr-TR", { year: "numeric", month: "long" })} mali dönemi kapalı; ${islem} yapılamaz`);
  }
}
