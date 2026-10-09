import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { verifySync } from "otplib";
import { platformJwtAnahtari, type PlatformJwtYuku } from "../auth/auth.guard";
import { coz } from "../core/kripto";
import { PlatformPrismaService } from "./platform-prisma.service";

/**
 * MVZ-04: platform ekibi girişi. Parola + iki adımlı doğrulama kodu birlikte
 * zorunludur; kullanıcılar `platform-kullanici-olustur` betiğiyle açılır.
 * Oturum kısa ömürlüdür (30 dk), yenileme yoktur.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly jwt: JwtService,
  ) {}

  async giris(eposta: string, parola: string, totpKodu: string) {
    const anahtar = platformJwtAnahtari();
    if (!anahtar) throw new UnauthorizedException("Platform paneli yapılandırılmamış");
    const hatali = new UnauthorizedException("E-posta, parola ya da doğrulama kodu hatalı");
    const kullanici = await this.platform.db.platformKullanici.findUnique({ where: { eposta: eposta.trim().toLowerCase() } });
    if (!kullanici || !kullanici.aktif) throw hatali;
    if (!(await argon2.verify(kullanici.parolaHash, parola))) throw hatali;
    if (!verifySync({ secret: coz(kullanici.totpSecretSifreli), token: totpKodu }).valid) throw hatali;

    await this.platform.db.platformKullanici.update({ where: { id: kullanici.id }, data: { sonGiris: new Date() } });
    await this.platform.db.mevzuatOlay.create({ data: { kullaniciId: kullanici.id, olay: "giris" } });
    const yuk: PlatformJwtYuku = { sub: kullanici.id, eposta: kullanici.eposta, kapsam: "platform" };
    return {
      accessToken: await this.jwt.signAsync(yuk, { secret: anahtar, expiresIn: "30m" }),
      kullanici: { id: kullanici.id, eposta: kullanici.eposta, adSoyad: kullanici.adSoyad },
    };
  }
}
