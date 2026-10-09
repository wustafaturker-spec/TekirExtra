import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { Rol } from "@tekirextra/shared";
import { baglamKur, platformBaglamKur } from "../core/istek-baglami";
import { PLATFORM_ANAHTAR, PUBLIC_ANAHTAR } from "./public.decorator";

export interface JwtYuku {
  sub: string; // userId
  tenantId: string;
  rol: Rol;
  /** Yalnız platform token'ında "platform" (MVZ-04). */
  kapsam?: string;
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
  ) {}

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

    baglamKur({
      tenantId: yuk.tenantId,
      userId: yuk.sub,
      rol: yuk.rol,
    });
    return true;
  }
}
