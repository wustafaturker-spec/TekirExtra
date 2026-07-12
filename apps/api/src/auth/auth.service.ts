import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { generateSecret, generateURI, verifySync } from "otplib";
import { coz, sifrele } from "../core/kripto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { JwtYuku } from "./auth.guard";

const REFRESH_GECERLILIK_GUN = 30;

export interface GirisSonucu {
  accessToken: string;
  refreshToken: string;
  kullanici: { id: string; adSoyad: string; eposta: string; rol: string };
}

function tokenHashle(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async giris(eposta: string, parola: string, totpKodu?: string): Promise<GirisSonucu> {
    // Rehber RLS'siz: oturum açarken kiracı bağlamı henüz yok (MIMARI §7)
    const kimlik = await this.prisma.authKimlik.findUnique({ where: { eposta } });
    // Kullanıcı yok/parola yanlış ayrımı sızdırılmaz — tek mesaj
    const hataliGiris = new UnauthorizedException("E-posta veya parola hatalı");
    if (!kimlik) throw hataliGiris;

    const kullanici = await this.prisma.tenantIslem(kimlik.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: kimlik.userId } }),
    );
    if (!kullanici || !kullanici.aktif) throw hataliGiris;
    if (!(await argon2.verify(kullanici.parolaHash, parola))) throw hataliGiris;

    if (!kullanici.epostaDogrulandi) {
      throw new UnauthorizedException(
        "E-posta adresiniz doğrulanmamış; gelen kutunuzdaki doğrulama linkine tıklayın",
      );
    }

    if (kullanici.totpAktif) {
      if (!totpKodu) {
        throw new UnauthorizedException("TOTP kodu gerekli");
      }
      const secret = coz(kullanici.totpSecretSifreli as string);
      if (!verifySync({ secret, token: totpKodu }).valid) {
        throw new UnauthorizedException("TOTP kodu geçersiz");
      }
    }

    return this.oturumAc(kullanici.tenantId, kullanici.id, kullanici.rol, {
      adSoyad: kullanici.adSoyad,
      eposta: kullanici.eposta,
    });
  }

  async yenile(refreshToken: string): Promise<GirisSonucu> {
    const oturum = await this.prisma.oturum.findUnique({
      where: { refreshTokenHash: tokenHashle(refreshToken) },
    });
    if (!oturum || oturum.gecerlilikSonu < new Date()) {
      throw new UnauthorizedException("Oturum geçersiz; yeniden giriş yapın");
    }
    const kullanici = await this.prisma.tenantIslem(oturum.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: oturum.userId } }),
    );
    if (!kullanici || !kullanici.aktif) {
      throw new UnauthorizedException("Oturum geçersiz; yeniden giriş yapın");
    }
    // Rotasyon: eski refresh token tek kullanımlıktır
    await this.prisma.oturum.delete({ where: { id: oturum.id } });
    return this.oturumAc(kullanici.tenantId, kullanici.id, kullanici.rol, {
      adSoyad: kullanici.adSoyad,
      eposta: kullanici.eposta,
    });
  }

  async cikis(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.oturum.deleteMany({
      where: { refreshTokenHash: tokenHashle(refreshToken) },
    });
  }

  async epostaDogrula(token: string): Promise<void> {
    const kayit = await this.prisma.epostaDogrulama.findUnique({
      where: { tokenHash: tokenHashle(token) },
    });
    if (!kayit || kayit.kullanildi || kayit.gecerlilikSonu < new Date()) {
      throw new BadRequestException("Doğrulama linki geçersiz veya süresi dolmuş");
    }
    await this.prisma.epostaDogrulama.update({
      where: { id: kayit.id },
      data: { kullanildi: true },
    });
    await this.prisma.tenantIslem(kayit.tenantId, (tx) =>
      tx.user.update({
        where: { id: kayit.userId },
        data: { epostaDogrulandi: true },
      }),
    );
  }

  /** TOTP kurulumu: şifreli secret kaydedilir, otpauth URL döner (KLN-05). */
  async totpKur(): Promise<{ otpauthUrl: string; secret: string }> {
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!kullanici) throw new UnauthorizedException();
    if (kullanici.totpAktif) {
      throw new BadRequestException("TOTP zaten etkin");
    }
    const secret = generateSecret();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { totpSecretSifreli: sifrele(secret), totpAktif: false },
      }),
    );
    return {
      otpauthUrl: generateURI({
        secret,
        issuer: "TekirExtra",
        label: kullanici.eposta,
      }),
      secret,
    };
  }

  /** Kurulumdaki secret ile üretilen ilk kod doğrulanınca TOTP etkinleşir. */
  async totpEtkinlestir(kod: string): Promise<void> {
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!kullanici?.totpSecretSifreli) {
      throw new BadRequestException("Önce TOTP kurulumu başlatın");
    }
    if (!verifySync({ secret: coz(kullanici.totpSecretSifreli), token: kod }).valid) {
      throw new BadRequestException("TOTP kodu geçersiz");
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.update({ where: { id: userId }, data: { totpAktif: true } }),
    );
  }

  private async oturumAc(
    tenantId: string,
    userId: string,
    rol: string,
    profil: { adSoyad: string; eposta: string },
  ): Promise<GirisSonucu> {
    const yuk: JwtYuku = { sub: userId, tenantId, rol: rol as JwtYuku["rol"] };
    const accessToken = await this.jwt.signAsync(yuk);
    const refreshToken = randomBytes(48).toString("base64url");
    const gecerlilikSonu = new Date(
      Date.now() + REFRESH_GECERLILIK_GUN * 24 * 60 * 60 * 1000,
    );
    await this.prisma.oturum.create({
      data: { tenantId, userId, refreshTokenHash: tokenHashle(refreshToken), gecerlilikSonu },
    });
    return {
      accessToken,
      refreshToken,
      kullanici: { id: userId, ...profil, rol },
    };
  }
}
