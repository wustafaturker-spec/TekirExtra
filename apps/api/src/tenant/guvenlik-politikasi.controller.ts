import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import { ROLLER } from "@tekirextra/shared";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { degisiklikleriBul } from "../core/denetim-farki";
import { HAREKETSIZLIK_SECENEKLERI, OTURUM_SURESI_EN_COK_GUN, type GuvenlikPolitikasi } from "../core/guvenlik-politikasi";
import { aktifBaglam } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";

const politikaSemasi = z.object({
  ikiAdimZorunluRoller: z.array(z.enum(ROLLER)).max(ROLLER.length).transform((r) => [...new Set(r)].sort()),
  oturumSuresiGun: z.number().int().min(1).max(OTURUM_SURESI_EN_COK_GUN),
  hareketsizlikDk: z.number().int().refine((d) => (HAREKETSIZLIK_SECENEKLERI as readonly number[]).includes(d), "15, 30, 60 ya da 240 dakika olmalı").nullable(),
});

const SECIM = { ikiAdimZorunluRoller: true, oturumSuresiGun: true, hareketsizlikDk: true } as const;

/** KLN-21/22: firmanın 2FA zorunluluğu ve oturum süresi politikası — yalnız yönetici. */
@Controller("guvenlik-politikasi")
@Roller("yonetici")
export class GuvenlikPolitikasiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly durum: KullaniciDurumService,
  ) {}

  @Get()
  async getir() {
    const { tenantId } = aktifBaglam();
    const [politika, eksikler] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: SECIM }),
        // Kaydetmeden önce kaç kişinin kuruluma yönleneceği görünsün.
        tx.user.groupBy({ by: ["rol"], where: { aktif: true, totpAktif: false }, _count: { _all: true } }),
      ]),
    );
    return { ...politika, ikiAdimsizKullanicilar: Object.fromEntries(eksikler.map((e) => [e.rol, e._count._all])) };
  }

  @Put()
  async guncelle(@Body() govde: unknown): Promise<GuvenlikPolitikasi> {
    const s = politikaSemasi.safeParse(govde);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { tenantId, userId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const onceki = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: SECIM });
      const guncel = await tx.tenant.update({ where: { id: tenantId }, data: s.data, select: SECIM });
      const degisiklikler = degisiklikleriBul(
        { ...onceki, ikiAdimZorunluRoller: onceki.ikiAdimZorunluRoller.join(", ") },
        { ...guncel, ikiAdimZorunluRoller: guncel.ikiAdimZorunluRoller.join(", ") },
      );
      if (Object.keys(degisiklikler).length) {
        await tx.auditLog.create({ data: { tenantId, userId, islem: "guvenlik_politikasi_degisti", varlik: "tenant", varlikId: tenantId, detay: { degisiklikler } as Prisma.InputJsonValue } });
      }
      return guncel;
    });
    // KLN-21: zorunluluk açılınca mevcut kullanıcılar bir sonraki isteklerinde kuruluma yönlenir.
    this.durum.hepsiniUnut();
    return sonuc;
  }
}
