import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { ROLLER } from "@tekirextra/shared";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const kullaniciOlusturSemasi = z.object({
  eposta: z.email(),
  adSoyad: z.string().min(2).max(120),
  rol: z.enum(ROLLER),
  parola: z
    .string()
    .min(10, "Parola en az 10 karakter olmalıdır")
    .regex(/[a-zA-Z]/, "Parola harf içermelidir")
    .regex(/\d/, "Parola rakam içermelidir"),
  maksIskontoYuzdesi: z.number().min(0).max(100).nullable().optional(),
});

const kullaniciGuncelleSemasi = z.object({
  rol: z.enum(ROLLER).optional(),
  aktif: z.boolean().optional(),
  maksIskontoYuzdesi: z.number().min(0).max(100).nullable().optional(),
});

const KULLANICI_SECIMI = {
  id: true,
  eposta: true,
  adSoyad: true,
  rol: true,
  aktif: true,
  epostaDogrulandi: true,
  totpAktif: true,
  maksIskontoYuzdesi: true,
} as const;

/** Firma içi kullanıcı yönetimi (KLN-02) — yalnızca yönetici. */
@Controller("kullanicilar")
@Roller("yonetici")
export class KullanicilarController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({ select: KULLANICI_SECIMI, orderBy: { createdAt: "asc" } }),
    );
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
    const { tenantId } = aktifBaglam();

    const mevcut = await this.prisma.authKimlik.findUnique({
      where: { eposta: girdi.eposta },
    });
    if (mevcut) {
      throw new ConflictException("Bu e-posta ile kayıtlı bir hesap zaten var");
    }

    const userId = randomUUID();
    const parolaHash = await argon2.hash(girdi.parola);
    // Yönetici tarafından açılan hesapta e-posta doğrulaması aranmaz (KLN-09
    // self-servis kayıt içindir); kullanıcı ilk girişte parolasını değiştirebilir.
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.create({
        data: {
          id: userId,
          tenantId,
          eposta: girdi.eposta,
          adSoyad: girdi.adSoyad,
          rol: girdi.rol,
          parolaHash,
          epostaDogrulandi: true,
          maksIskontoYuzdesi: girdi.maksIskontoYuzdesi !== undefined && girdi.maksIskontoYuzdesi !== null
            ? new Prisma.Decimal(girdi.maksIskontoYuzdesi)
            : null,
        },
        select: KULLANICI_SECIMI,
      }),
    );
    await this.prisma.authKimlik.create({
      data: { eposta: girdi.eposta, tenantId, userId },
    });
    return kullanici;
  }

  @Patch(":id")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kullaniciGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("Geçersiz kullanıcı bilgisi");
    }
    const { tenantId, userId } = aktifBaglam();
    if (id === userId && ayristirma.data.aktif === false) {
      throw new BadRequestException("Kendi hesabınızı pasifleştiremezsiniz");
    }
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.user.update({
          where: { id },
          data: {
            ...ayristirma.data,
            maksIskontoYuzdesi: ayristirma.data.maksIskontoYuzdesi !== undefined
              ? (ayristirma.data.maksIskontoYuzdesi !== null ? new Prisma.Decimal(ayristirma.data.maksIskontoYuzdesi) : null)
              : undefined,
          },
          select: KULLANICI_SECIMI,
        }),
      );
    } catch {
      throw new NotFoundException("Kullanıcı bulunamadı");
    }
  }
}
