import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, RequestMethod } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import {
  gecerliYetkiAnahtariMi,
  ROLLER,
  yetkiAnahtari,
  yolIslemi,
  yolModulu,
  type Rol,
} from "@tekirextra/shared";
import { z } from "zod";
import { DESTEK_OTURUMUNDA_ACIK_ANAHTAR, PLATFORM_ANAHTAR, PUBLIC_ANAHTAR, SALT_OKUMA_ANAHTAR } from "../auth/public.decorator";
import { ROLLER_ANAHTAR, Roller } from "../auth/roller.decorator";
import { rolUcaYetkili } from "../auth/roller.guard";
import { aktifBaglam } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";

/** Çalışan ve B2B bayi ayrı akışlarla çalışır; şablon olamaz. */
export const SABLON_ROLLERI = ROLLER.filter((r) => r !== "calisan" && r !== "b2b_bayi") as Rol[];

const kutular = z.array(z.string().refine(gecerliYetkiAnahtariMi, "Geçersiz yetki kutusu")).max(200).transform((k) => [...new Set(k)].sort());
const olusturSemasi = z.object({
  ad: z.string().trim().min(2, "Ad en az 2 karakter").max(80),
  sablonRol: z.enum(SABLON_ROLLERI as [Rol, ...Rol[]]),
  kapaliKutular: kutular,
});
const guncelleSemasi = z.object({
  ad: z.string().trim().min(2).max(80).optional(),
  kapaliKutular: kutular.optional(),
  aktif: z.boolean().optional(),
});

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}

/**
 * KLN-20: her şablonun ekranda erişebildiği kutular. Uçların `@Roller`
 * bilgisinden çıkar (çalışma anında bir kez); şablonun hiç erişemediği kutu
 * özel rolde açık/kapalı seçilemez.
 */
@Injectable()
export class SablonMatrisiService {
  private onbellek: Record<string, string[]> | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  matris(): Record<string, string[]> {
    if (this.onbellek) return this.onbellek;
    const uclar: { anahtar: string; gerekli: Rol[] | undefined }[] = [];
    for (const sarmal of this.discovery.getControllers()) {
      const sinif = sarmal.metatype as (new (...a: unknown[]) => object) | undefined;
      if (!sinif || !sarmal.instance) continue;
      const onek = String(Reflect.getMetadata(PATH_METADATA, sinif) ?? "");
      const proto = Object.getPrototypeOf(sarmal.instance) as object;
      for (const ad of this.scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[ad] as object;
        const yontemKodu = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (yontemKodu === undefined) continue;
        const yol = [onek, String(Reflect.getMetadata(PATH_METADATA, handler) ?? "")].filter(Boolean).join("/");
        const modul = yolModulu(yol);
        if (!modul) continue;
        // Oturumsuz uçlar (POS geri çağırma, makbuz, mutabakat portalı…) ve platform uçları rol denetimine girmez; matrise sayılmaz.
        if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ANAHTAR, [handler as never, sinif]) || this.reflector.getAllAndOverride<boolean>(PLATFORM_ANAHTAR, [handler as never, sinif])) continue;
        const saltOkuma = Boolean(this.reflector.getAllAndOverride<boolean>(SALT_OKUMA_ANAHTAR, [handler as never, sinif]) || this.reflector.getAllAndOverride<boolean>(DESTEK_OTURUMUNDA_ACIK_ANAHTAR, [handler as never, sinif]));
        const islem = yolIslemi(RequestMethod[yontemKodu], yol, saltOkuma);
        if (islem === "goruntule" && modul.yalnizYazma) continue;
        uclar.push({ anahtar: yetkiAnahtari(modul.kod, islem), gerekli: this.reflector.getAllAndOverride<Rol[] | undefined>(ROLLER_ANAHTAR, [handler as never, sinif]) });
      }
    }
    this.onbellek = Object.fromEntries(SABLON_ROLLERI.map((rol) => [rol, [...new Set(uclar.filter((u) => rolUcaYetkili(rol, u.gerekli)).map((u) => u.anahtar))].sort()]));
    return this.onbellek;
  }
}

/** KLN-20: özel roller — şablondan türetilir, yalnız kutu kapatır. Yalnız yönetici. */
@Controller("ozel-roller")
@Roller("yonetici")
export class OzelRollerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matris: SablonMatrisiService,
    private readonly durum: KullaniciDurumService,
  ) {}

  @Get()
  async listele() {
    const { tenantId } = aktifBaglam();
    const roller = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ozelRol.findMany({ orderBy: { ad: "asc" }, include: { _count: { select: { kullanicilar: true } } } }),
    );
    return roller.map(({ _count, ...r }) => ({ ...r, kullaniciSayisi: _count.kullanicilar }));
  }

  /** Şablon başına seçilebilir kutular (matris ekranı). */
  @Get("sablon-matrisi")
  sablonMatrisi() {
    return this.matris.matris();
  }

  @Post()
  async olustur(@Body() govde: unknown) {
    const g = ayristir(olusturSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    const kapali = this.sablondaOlanlar(g.sablonRol, g.kapaliKutular);
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const r = await tx.ozelRol.create({ data: { tenantId, ad: g.ad, sablonRol: g.sablonRol, kapaliKutular: kapali } });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "ozel_rol_olusturuldu", varlik: "ozel_rol", varlikId: r.id, detay: { ad: r.ad, sablonRol: r.sablonRol, kapaliKutular: kapali } } });
        return r;
      });
    } catch (h) {
      if (h instanceof Prisma.PrismaClientKnownRequestError && h.code === "P2002") throw new ConflictException("Bu adla bir özel rol zaten var");
      throw h;
    }
  }

  @Patch(":id")
  async guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = ayristir(guncelleSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.ozelRol.findUnique({ where: { id } });
      if (!mevcut) throw new NotFoundException("Özel rol bulunamadı");
      const kapali = g.kapaliKutular ? this.sablondaOlanlar(mevcut.sablonRol, g.kapaliKutular) : undefined;
      const guncel = await tx.ozelRol.update({ where: { id }, data: { ad: g.ad, aktif: g.aktif, kapaliKutular: kapali } });
      const degisiklikler: Record<string, { eski: unknown; yeni: unknown }> = {};
      if (mevcut.ad !== guncel.ad) degisiklikler.ad = { eski: mevcut.ad, yeni: guncel.ad };
      if (mevcut.aktif !== guncel.aktif) degisiklikler.aktif = { eski: mevcut.aktif, yeni: guncel.aktif };
      const acilan = mevcut.kapaliKutular.filter((k) => !guncel.kapaliKutular.includes(k));
      const kapanan = guncel.kapaliKutular.filter((k) => !mevcut.kapaliKutular.includes(k));
      if (acilan.length || kapanan.length) degisiklikler.kapaliKutular = { eski: mevcut.kapaliKutular, yeni: guncel.kapaliKutular };
      if (Object.keys(degisiklikler).length) {
        await tx.auditLog.create({ data: { tenantId, userId, islem: "ozel_rol_guncellendi", varlik: "ozel_rol", varlikId: id, detay: { ad: guncel.ad, degisiklikler, acilan, kapanan } as Prisma.InputJsonValue } });
      }
      return guncel;
    }).catch((h: unknown) => {
      if (h instanceof Prisma.PrismaClientKnownRequestError && h.code === "P2002") throw new ConflictException("Bu adla bir özel rol zaten var");
      throw h;
    });
    // Bu süreçte beklemeden, diğerlerinde en geç 10 sn içinde.
    this.durum.hepsiniUnut();
    return sonuc;
  }

  /** Kullanıcısı olan rol silinmez; pasife alınır. */
  @Delete(":id")
  async sil(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const r = await tx.ozelRol.findUnique({ where: { id }, include: { _count: { select: { kullanicilar: true } } } });
      if (!r) throw new NotFoundException("Özel rol bulunamadı");
      if (r._count.kullanicilar) throw new BadRequestException(`Bu rolde ${r._count.kullanicilar} kullanıcı var; silinemez, pasife alabilirsiniz`);
      await tx.ozelRol.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "ozel_rol_silindi", varlik: "ozel_rol", varlikId: id, detay: { ad: r.ad, sablonRol: r.sablonRol } } });
    });
    return { mesaj: "Özel rol silindi" };
  }

  /** Şablonun hiç erişemediği kutular zaten kapalıdır; saklanmaz. */
  private sablondaOlanlar(sablon: Rol, kapali: string[]): string[] {
    const acik = new Set(this.matris.matris()[sablon] ?? []);
    return kapali.filter((k) => acik.has(k));
  }
}
