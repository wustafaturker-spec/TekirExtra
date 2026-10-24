import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { Rol } from "@tekirextra/shared";
import { baglamKur, platformBaglamKur } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { PLATFORM_ANAHTAR, PUBLIC_ANAHTAR } from "./public.decorator";

export interface JwtYuku {
  sub: string; // userId
  tenantId: string;
  rol: Rol;
  /** Yalnız platform token'ında "platform" (MVZ-04). */
  kapsam?: string;
  /** Yönetim P1-2: kullanıcının oturum sürümü; eski token'larda yoktur (0 sayılır). */
  sv?: number;
}

/** MVZ-04: platform ekibi token'ı; kiracı token'ından ayrı anahtarla imzalanır. */
export interface PlatformJwtYuku {
  sub: string;
  eposta: string;
  kapsam: "platform";
}

/** Platform anahtarı yoksa platform uçları kapalıdır (kiracı anahtarına düşülmez). */
export function platformJwtAnahtari(): string | undefined {
  const anahtar = process.env.PLATFORM_JWT_SECRET;
  if (!anahtar || anahtar === process.env.JWT_SECRET) return undefined;
  return anahtar;
}

/**
 * Global kimlik guard'ı: Bearer token'ı doğrular, istek bağlamını
 * (AsyncLocalStorage) kurar. @Public uçları atlar.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    // Uygulamada Nest bağlar; guard'ı elle kuran kabul testlerinde durum denetimi atlanır.
    @Optional() private readonly durum?: KullaniciDurumService,
    @Optional() private readonly platformDb?: PlatformPrismaService,
  ) {}

  /** Platform P1-2: pasife alınan platform kullanıcısı en geç 10 sn içinde düşer. */
  private readonly platformAktif = new Map<string, { aktif: boolean; bitis: number }>();

  private async platformKullanicisiAktifMi(id: string): Promise<boolean> {
    if (!this.platformDb) return true;
    const simdi = Date.now();
    const k = this.platformAktif.get(id);
    if (k && k.bitis > simdi) return k.aktif;
    const kayit = await this.platformDb.db.platformKullanici.findUnique({ where: { id }, select: { aktif: true } });
    const aktif = Boolean(kayit?.aktif);
    if (this.platformAktif.size > 1_000) this.platformAktif.clear();
    this.platformAktif.set(id, { aktif, bitis: simdi + 10_000 });
    return aktif;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publicMi = this.reflector.getAllAndOverride<boolean>(PUBLIC_ANAHTAR, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publicMi) return true;

    const istek = context.switchToHttp().getRequest<Request>();
    const token = istek.headers.authorization?.replace(/^Bearer /, "");
    if (!token) {
      throw new UnauthorizedException("Oturum token'ı gerekli");
    }

    const platformUcu = this.reflector.getAllAndOverride<boolean>(PLATFORM_ANAHTAR, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (platformUcu) {
      const anahtar = platformJwtAnahtari();
      if (!anahtar) throw new UnauthorizedException("Platform paneli yapılandırılmamış");
      let platformYuku: PlatformJwtYuku;
      try {
        platformYuku = await this.jwt.verifyAsync<PlatformJwtYuku>(token, { secret: anahtar });
      } catch {
        throw new UnauthorizedException("Token geçersiz veya süresi dolmuş");
      }
      if (platformYuku.kapsam !== "platform") throw new UnauthorizedException("Token geçersiz veya süresi dolmuş");
      if (!(await this.platformKullanicisiAktifMi(platformYuku.sub))) throw new UnauthorizedException("Platform hesabı pasif");
      platformBaglamKur({ kullaniciId: platformYuku.sub, eposta: platformYuku.eposta });
      return true;
    }

    let yuk: JwtYuku;
    try {
      yuk = await this.jwt.verifyAsync<JwtYuku>(token);
    } catch {
      throw new UnauthorizedException("Token geçersiz veya süresi dolmuş");
    }
    // Anahtarlar ayrı olduğu için platform token'ı buraya ulaşmaz; yine de kapsam denetlenir.
    if (yuk.kapsam === "platform" || !yuk.tenantId) {
      throw new UnauthorizedException("Token geçersiz veya süresi dolmuş");
    }

    if (this.durum && !(await this.guncelMi(yuk))) {
      throw new UnauthorizedException("Oturumunuz güncel değil; yeniden giriş yapın");
    }

    baglamKur({
      tenantId: yuk.tenantId,
      userId: yuk.sub,
      rol: yuk.rol,
    });
    return true;
  }

  /** Pasif, rolü değişmiş ya da parolası/2FA'sı sıfırlanmış kullanıcının token'ı geçmez. */
  private async guncelMi(yuk: JwtYuku): Promise<boolean> {
    const uyar = (d: { aktif: boolean; rol: string | null; oturumSurumu: number }) =>
      d.aktif && d.rol === yuk.rol && d.oturumSurumu === (yuk.sv ?? 0);
    if (uyar(await this.durum!.getir(yuk.tenantId, yuk.sub))) return true;
    // Önbellek bayat olabilir (ör. token az önce yeni sürümle yenilendi): bir kez taze oku.
    return uyar(await this.durum!.getir(yuk.tenantId, yuk.sub, true));
  }
}
