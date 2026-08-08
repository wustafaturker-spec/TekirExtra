import { Controller, Get, Query } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

/**
 * Denetim izi görüntüleme (KLN-04a). Kayıtlar yalnızca okunur: yazma işini
 * AuditInterceptor yapar, hiçbir uç silme/değiştirme sunmaz.
 */
@Controller("denetim")
@Roller("yonetici")
export class DenetimController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listele(
    @Query("varlik") varlik?: string,
    @Query("userId") userId?: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
  ) {
    const { tenantId } = aktifBaglam();
    const sayfaAdedi = Math.min(Math.max(Number(adet) || 50, 1), 200);

    const kosul: Prisma.AuditLogWhereInput = {
      ...(varlik ? { varlik } : {}),
      ...(userId ? { userId } : {}),
      ...(baslangic || bitis
        ? {
            createdAt: {
              ...(baslangic ? { gte: new Date(baslangic) } : {}),
              // bitiş günü dahil olsun diye ertesi günün başlangıcına kadar
              ...(bitis ? { lt: new Date(new Date(bitis).getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    };

    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: kosul,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: sayfaAdedi + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
      }),
    );

    const sonrakiImlec = kayitlar.length > sayfaAdedi ? kayitlar[sayfaAdedi - 1].id : null;
    const sayfa = kayitlar.slice(0, sayfaAdedi);

    const kullaniciIdler = [...new Set(sayfa.map((k) => k.userId).filter((k): k is string => !!k))];
    const kullanicilar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({
        where: { id: { in: kullaniciIdler } },
        select: { id: true, adSoyad: true, eposta: true },
      }),
    );
    const kullaniciHaritasi = new Map(kullanicilar.map((k) => [k.id, k]));

    return {
      kayitlar: sayfa.map((k) => ({
        id: k.id,
        islem: k.islem,
        varlik: k.varlik,
        varlikId: k.varlikId,
        detay: k.detay,
        zaman: k.createdAt,
        kullanici: k.userId ? (kullaniciHaritasi.get(k.userId) ?? null) : null,
      })),
      sonrakiImlec,
    };
  }

  /** Filtre kutularını doldurmak için izde geçen varlık türleri. */
  @Get("varliklar")
  async varliklar() {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.auditLog.findMany({
        distinct: ["varlik"],
        select: { varlik: true },
        orderBy: { varlik: "asc" },
      }),
    );
    return kayitlar.map((k) => k.varlik);
  }
}
