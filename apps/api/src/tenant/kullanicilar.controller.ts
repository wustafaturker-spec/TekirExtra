import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { ROLLER } from "@tekirextra/shared";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { parolaSemasi } from "../auth/parola-kurali";
import { aktifBaglam } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import { AbonelikService } from "./abonelik.service";
import { EpostaDegisimiService } from "./eposta-degisimi.service";
import { ParolaService } from "./parola.service";

const kullaniciOlusturSemasi = z.object({
  eposta: z.email(),
  adSoyad: z.string().min(2).max(120),
  rol: z.enum(ROLLER),
  // Yönetim P2-3: davetle açılan hesapta parolayı kullanıcı belirler.
  davet: z.boolean().optional().default(false),
  parola: parolaSemasi.optional(),
  maksIskontoYuzdesi: z.number().min(0).max(100).nullable().optional(),
  bayiCariId: z.string().uuid().nullable().optional(),
}).refine((g) => g.davet || g.parola, { message: "Parola girin ya da davet e-postası seçin", path: ["parola"] });

const kullaniciGuncelleSemasi = z.object({
  rol: z.enum(ROLLER).optional(),
  aktif: z.boolean().optional(),
  maksIskontoYuzdesi: z.number().min(0).max(100).nullable().optional(),
  bayiCariId: z.string().uuid().nullable().optional(),
});

const KULLANICI_SECIMI = {
  id: true,
  eposta: true,
  adSoyad: true,
  rol: true,
  aktif: true,
  epostaDogrulandi: true,
  totpAktif: true,
  sonGirisAt: true,
  maksIskontoYuzdesi: true,
  bayiCariId: true,
  bayiCari: { select: { id: true, kod: true, unvan: true } },
} as const;

/** Firma içi kullanıcı yönetimi (KLN-02) — yalnızca yönetici. */
@Controller("kullanicilar")
@Roller("yonetici")
export class KullanicilarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abonelik: AbonelikService,
    private readonly parola: ParolaService,
    private readonly durum: KullaniciDurumService,
    private readonly epostaDegisimi: EpostaDegisimiService,
  ) {}

  private async bayiCariDogrula(tenantId: string, bayiCariId?: string | null) {
    if (!bayiCariId) return;
    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findFirst({ where: { id: bayiCariId, tenantId, aktif: true }, select: { id: true } }),
    );
    if (!cari) throw new BadRequestException("Atanacak bayi/cari bu firmada bulunamadı veya pasif");
  }

  @Get()
  async listele() {
    const { tenantId } = aktifBaglam();
    const [kullanicilar, politika] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.user.findMany({ select: KULLANICI_SECIMI, orderBy: { createdAt: "asc" } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { ikiAdimZorunluRoller: true } }),
      ]),
    );
    // KLN-21: ekranda "2FA zorunlu ama kurulmamış" gösterilir.
    const zorunlu = politika?.ikiAdimZorunluRoller ?? [];
    return kullanicilar.map((k) => ({ ...k, ikiAdimZorunlu: zorunlu.includes(k.rol) }));
  }

  @Post()
  async olustur(@Body() govde: unknown) {
    const ayristirma = kullaniciOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    const girdi = ayristirma.data;
    if (girdi.rol === "calisan") throw new BadRequestException("Çalışan hesabı personel kartından self-servis davetiyle açılır");
    await this.abonelik.limitDogrula("kullanici");
    const { tenantId } = aktifBaglam();
    await this.bayiCariDogrula(tenantId, girdi.bayiCariId);

    const mevcut = await this.prisma.authKimlik.findUnique({
      where: { eposta: girdi.eposta },
    });
    if (mevcut) {
      throw new ConflictException("Bu e-posta ile kayıtlı bir hesap zaten var");
    }

    const userId = randomUUID();
    // Davette girilemeyen rastgele parola konur; kullanıcı bağlantıyla kendi parolasını belirler.
    const parolaHash = await argon2.hash(girdi.davet ? randomBytes(32).toString("base64url") : (girdi.parola as string));
    // Yönetici parolası verilen hesapta e-posta doğrulaması aranmaz (KLN-09
    // self-servis kayıt içindir). Davetli hesap bağlantı kullanılınca doğrulanır.
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.create({
        data: {
          id: userId,
          tenantId,
          eposta: girdi.eposta,
          adSoyad: girdi.adSoyad,
          rol: girdi.rol,
          parolaHash,
          epostaDogrulandi: !girdi.davet,
          maksIskontoYuzdesi: girdi.maksIskontoYuzdesi !== undefined && girdi.maksIskontoYuzdesi !== null
            ? new Prisma.Decimal(girdi.maksIskontoYuzdesi)
            : null,
          bayiCariId: girdi.rol === "b2b_bayi" ? girdi.bayiCariId : null,
        },
        select: KULLANICI_SECIMI,
      }),
    );
    await this.prisma.authKimlik.create({
      data: { eposta: girdi.eposta, tenantId, userId },
    });
    if (!girdi.davet) return kullanici;
    return { ...kullanici, davet: await this.parola.davetGonder(userId) };
  }

  /** Yönetim P2-3: daveti kabul etmemiş kullanıcıya yeni bağlantı gönderir. */
  @Post(":id/davet")
  @HttpCode(200)
  davetGonder(@Param("id") id: string) {
    return this.parola.davetGonder(id);
  }

  /** KLN-10: yönetici kullanıcıya geçici parola verir; kullanıcının oturumları kapanır. */
  @Post(":id/parola")
  @HttpCode(200)
  parolaSifirla(@Param("id") id: string, @Body() govde: unknown) {
    return this.parola.yoneticiSifirla(id, govde);
  }

  /** KLN-23: yeni adrese doğrulama bağlantısı gider; kullanılınca giriş e-postası değişir. */
  @Post(":id/eposta")
  @HttpCode(200)
  epostaDegistir(@Param("id") id: string, @Body() govde: unknown) {
    return this.epostaDegisimi.yoneticiBaslat(id, govde);
  }

  /** Yönetim P2-4: kullanıcının bütün oturumları kapanır. */
  @Post(":id/oturumlari-kapat")
  @HttpCode(200)
  oturumlariKapat(@Param("id") id: string) {
    return this.parola.yoneticiOturumlariKapat(id);
  }

  /** Yönetim P1-1: kullanıcının 2FA'sı kapatılır (telefon kaybı); oturumları kapanır. */
  @Post(":id/iki-adim-sifirla")
  @HttpCode(200)
  ikiAdimSifirla(@Param("id") id: string) {
    return this.parola.yoneticiIkiAdimSifirla(id);
  }

  @Patch(":id")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kullaniciGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz kullanıcı bilgisi");
    }
    const girdi = ayristirma.data;
    const { tenantId, userId } = aktifBaglam();
    await this.bayiCariDogrula(tenantId, girdi.bayiCariId);
    if (id === userId && girdi.aktif === false) {
      throw new BadRequestException("Kendi hesabınızı pasifleştiremezsiniz");
    }
    if (id === userId && girdi.rol !== undefined) {
      throw new BadRequestException("Kendi rolünüzü değiştiremezsiniz; başka bir yönetici değiştirebilir");
    }
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Yönetici sayısı kuralı aynı anda iki değişiklikte de tutsun diye firma başına sıralanır.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:kullanici-yetki`}, 0))::text`;
      const mevcut = await tx.user.findUnique({
        where: { id },
        select: { rol: true, aktif: true, maksIskontoYuzdesi: true, bayiCariId: true, eposta: true },
      });
      if (!mevcut) throw new NotFoundException("Kullanıcı bulunamadı");
      // PRS-21: çalışan hesabı personel kartına bağlıdır; rolü buradan değişmez, başka hesap çalışan yapılmaz.
      if (girdi.rol && (mevcut.rol === "calisan") !== (girdi.rol === "calisan")) {
        throw new BadRequestException("Çalışan self-servis hesabının rolü değiştirilemez; erişim personel kartından yönetilir");
      }
      const yeniRol = girdi.rol ?? mevcut.rol;
      const yeniAktif = girdi.aktif ?? mevcut.aktif;
      // Yönetim P0-2: firmada en az bir aktif yönetici kalır.
      if (mevcut.rol === "yonetici" && mevcut.aktif && (yeniRol !== "yonetici" || !yeniAktif)) {
        const digerYoneticiler = await tx.user.count({ where: { rol: "yonetici", aktif: true, id: { not: id } } });
        if (digerYoneticiler === 0) throw new BadRequestException("Firmada en az bir aktif yönetici kalmalıdır; önce başka bir kullanıcıyı yönetici yapın");
      }
      // Yönetim P2-2: geri açılan hesap da abonelik kullanıcı sınırına sayılır.
      if (!mevcut.aktif && yeniAktif && yeniRol !== "calisan") {
        await this.abonelik.limitDogrula("kullanici");
      }
      const maksIskontoYuzdesi = girdi.maksIskontoYuzdesi !== undefined
        ? (girdi.maksIskontoYuzdesi !== null ? new Prisma.Decimal(girdi.maksIskontoYuzdesi) : null)
        : undefined;
      const guncel = await tx.user.update({
        where: { id },
        data: {
          ...girdi,
          bayiCariId: girdi.rol && girdi.rol !== "b2b_bayi" ? null : girdi.bayiCariId,
          maksIskontoYuzdesi,
        },
        select: KULLANICI_SECIMI,
      });
      // Yönetim P1-4: yetki değişikliği eski → yeni değerleriyle denetim izine yazılır.
      const degisiklikler: Record<string, { eski: unknown; yeni: unknown }> = {};
      const karsilastir = (alan: string, eski: unknown, yeni: unknown) => {
        if (String(eski ?? "") !== String(yeni ?? "")) degisiklikler[alan] = { eski: eski ?? null, yeni: yeni ?? null };
      };
      karsilastir("rol", mevcut.rol, guncel.rol);
      karsilastir("aktif", mevcut.aktif, guncel.aktif);
      karsilastir("maksIskontoYuzdesi", mevcut.maksIskontoYuzdesi?.toString(), guncel.maksIskontoYuzdesi?.toString());
      karsilastir("bayiCariId", mevcut.bayiCariId, guncel.bayiCariId);
      if (Object.keys(degisiklikler).length) {
        await tx.auditLog.create({
          data: { tenantId, userId, islem: "kullanici_yetkisi_degisti", varlik: "user", varlikId: id, detay: { eposta: mevcut.eposta, degisiklikler } as Prisma.InputJsonValue },
        });
      }
      return guncel;
    });
    // Yönetim P1-2: pasife alınan ya da rolü değişen kullanıcının eldeki token'ı beklemeden düşer.
    this.durum.unut(id);
    if (girdi.aktif === false) await this.prisma.oturum.deleteMany({ where: { userId: id } });
    return sonuc;
  }
}
