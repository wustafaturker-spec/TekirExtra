import { ConflictException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class DonemKilidiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Açık bir işlemin içinden çağrılıyorsa `tx` verilmelidir: aksi hâlde işlem
   * bağlantısını tutarken havuzdan ikinci bir bağlantı ister ve yük altında
   * havuz kilitlenir (STK-35: 40 paralel stok hareketinin 33'ü 503 aldı).
   */
  async tarihDogrula(tenantId: string, tarih: Date | string, islem: string, tx?: Prisma.TransactionClient): Promise<void> {
    const deger = tarih instanceof Date ? tarih : new Date(tarih);
    const oku = (t: Prisma.TransactionClient) => t.maliDonem.findUnique({
      where: { tenantId_yil_ay: { tenantId, yil: deger.getFullYear(), ay: deger.getMonth() + 1 } }, select: { durum: true },
    });
    const kilit = tx ? await oku(tx) : await this.prisma.tenantIslem(tenantId, oku);
    if (kilit?.durum === "kapali") throw new ConflictException(`${deger.toLocaleDateString("tr-TR", { year: "numeric", month: "long" })} mali dönemi kapalı; ${islem} yapılamaz`);
  }
}
