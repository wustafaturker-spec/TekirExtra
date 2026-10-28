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
  // KLN-20: özel rol "ozel:<id>" ile seçilir.
  ikiAdimZorunluRoller: z.array(z.union([z.enum(ROLLER), z.string().regex(/^ozel:[0-9a-f-]{36}$/)])).max(200).transform((r) => [...new Set(r)].sort()),
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
        tx.user.groupBy({ by: ["rol", "ozelRolId"], where: { aktif: true, totpAktif: false }, _count: { _all: true } }),
      ]),
    );
    const sayilar: Record<string, number> = {};
    for (const e of eksikler) {
      sayilar[e.rol] = (sayilar[e.rol] ?? 0) + e._count._all;
      if (e.ozelRolId) sayilar[`ozel:${e.ozelRolId}`] = (sayilar[`ozel:${e.ozelRolId}`] ?? 0) + e._count._all;
    }
    return { ...politika, ikiAdimsizKullanicilar: sayilar };
  }

  @Put()
  async guncelle(@Body() govde: unknown): Promise<GuvenlikPolitikasi> {
    const s = politikaSemasi.safeParse(govde);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { tenantId, userId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const ozelIdler = s.data.ikiAdimZorunluRoller.filter((r) => r.startsWith("ozel:")).map((r) => r.slice(5));
      if (ozelIdler.length && (await tx.ozelRol.count({ where: { id: { in: ozelIdler } } })) !== ozelIdler.length) {
        throw new BadRequestException("Seçilen özel rollerden biri bulunamadı");
      }
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
