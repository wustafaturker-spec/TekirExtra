import { BadRequestException, Body, Controller, Get, HttpCode, Optional, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { DestekOturumService } from "../core/destek-oturum.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";

/** KLN-24: 1 saat / 24 saat / 7 gün. */
export const DESTEK_IZNI_SURELERI = [1, 24, 168] as const;
const izinSemasi = z.object({ sureSaat: z.union([z.literal(1), z.literal(24), z.literal(168)]) });

/**
 * KLN-24: firma yöneticisi TekirExtra ekibine süreli, salt okunur destek
 * erişimi izni verir ve istediği an geri alır. Geri alınınca açık destek
 * oturumları kapanır (eldeki token en geç 10 sn içinde düşer).
 */
@Controller("destek-izni")
@Roller("yonetici")
export class DestekIzniController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly destek: DestekOturumService,
    @Optional() private readonly platformDb?: PlatformPrismaService,
  ) {}

  @Get()
  async durum() {
    const { tenantId } = aktifBaglam();
    const simdi = new Date();
    const [izin, oturumlar] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.destekIzni.findFirst({
          where: { geriAlindiAt: null, bitis: { gt: simdi } },
          orderBy: { bitis: "desc" },
          select: { id: true, sureSaat: true, baslangic: true, bitis: true, veren: { select: { adSoyad: true } } },
        }),
        tx.destekOturumu.findMany({
          orderBy: { acilis: "desc" },
          take: 20,
          select: { id: true, platformKullaniciAdi: true, acilis: true, bitis: true, kapanis: true, kapanisNedeni: true },
        }),
      ]),
    );
    return {
      izin: izin ? { ...izin, veren: izin.veren.adSoyad } : null,
      oturumlar: oturumlar.map((o) => ({ ...o, acik: !o.kapanis && o.bitis > simdi && Boolean(izin) })),
    };
  }

  /** Etkin izin varsa süresi şimdiden yeniden başlar; yoksa yeni izin açılır. */
  @Post()
  @HttpCode(200)
  async ver(@Body() govde: unknown) {
    const s = izinSemasi.safeParse(govde);
    if (!s.success) throw new BadRequestException("Süre 1 saat, 24 saat ya da 7 gün olmalıdır");
    const { tenantId, userId } = aktifBaglam();
    const bitis = new Date(Date.now() + s.data.sureSaat * 3_600_000);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.destekIzni.findFirst({ where: { geriAlindiAt: null, bitis: { gt: new Date() } }, select: { id: true } });
      if (mevcut) await tx.destekIzni.update({ where: { id: mevcut.id }, data: { sureSaat: s.data.sureSaat, bitis } });
      else await tx.destekIzni.create({ data: { tenantId, verenUserId: userId, sureSaat: s.data.sureSaat, bitis } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "destek_izni_verildi", varlik: "destek_izni", detay: { sureSaat: s.data.sureSaat, bitis: bitis.toISOString(), uzatildi: Boolean(mevcut) } } });
    });
    return { mesaj: `TekirExtra destek ekibi ${bitis.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} saatine kadar panelinizi salt okunur görebilir.`, bitis };
  }

  @Post("geri-al")
  @HttpCode(200)
  async geriAl() {
    const { tenantId, userId } = aktifBaglam();
    const simdi = new Date();
    const kapanan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const { count } = await tx.destekIzni.updateMany({ where: { geriAlindiAt: null, bitis: { gt: simdi } }, data: { geriAlindiAt: simdi, geriAlanUserId: userId } });
      if (!count) throw new BadRequestException("Etkin bir destek izni yok");
      const acik = await tx.destekOturumu.findMany({ where: { kapanis: null, bitis: { gt: simdi } }, select: { id: true, platformKullaniciId: true, platformKullaniciAdi: true } });
      await tx.destekOturumu.updateMany({ where: { id: { in: acik.map((o) => o.id) } }, data: { kapanis: simdi, kapanisNedeni: "izin_geri_alindi" } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "destek_izni_geri_alindi", varlik: "destek_izni", detay: { kapananOturum: acik.length } } });
      return acik;
    });
    this.destek.hepsiniUnut();
    // PLT-10: kapanış platform olay kaydına da yazılır.
    for (const o of kapanan) {
      await this.platformDb?.db.mevzuatOlay
        .create({ data: { kullaniciId: o.platformKullaniciId, olay: "destek_oturumu_kapatildi", detay: { tenantId, oturumId: o.id, neden: "izin_geri_alindi" } } })
        .catch(() => undefined);
    }
    return { mesaj: kapanan.length ? `Destek izni geri alındı; açık ${kapanan.length} destek oturumu kapatıldı.` : "Destek izni geri alındı." };
  }
}
