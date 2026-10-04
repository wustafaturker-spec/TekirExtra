import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Rol } from "@tekirextra/shared";
import { baglamAl } from "../core/istek-baglami";
import { ROLLER_ANAHTAR } from "./roller.decorator";

/** Çalışan rolünün @Roller("calisan") dışında erişebildiği hesap uçları. */
export const CALISAN_ACIK_YOLLAR = ["/auth/ben", "/auth/totp", "/auth/cikis", "/bildirimler"];

/** Rol denetimi (KLN-02): @Roller listesi + yonetici her zaman geçer. */
@Injectable()
export class RollerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const gerekli = this.reflector.getAllAndOverride<Rol[] | undefined>(
      ROLLER_ANAHTAR,
      [context.getHandler(), context.getClass()],
    );
    const baglam = baglamAl();
    // PRS-21: çalışan rolü yalnız adının açıkça geçtiği uçlara ve hesabının
    // oturum/bildirim uçlarına erişir; @Roller taşımayan genel uçlar ona kapalı.
    if (baglam?.rol === "calisan") {
      if (gerekli?.includes("calisan")) return true;
      const yol = String(context.switchToHttp().getRequest<{ path?: string }>()?.path ?? "").replace(/^\/api\/v\d+/, "");
      if (CALISAN_ACIK_YOLLAR.some((onek) => yol === onek || yol.startsWith(`${onek}/`))) return true;
      throw new ForbiddenException("Bu işlem için yetkiniz yok");
    }
    if (!gerekli || gerekli.length === 0) return true;
    if (!baglam) return true; // @Public uçlar — AuthGuard zaten karar verdi

    if (baglam.rol === "yonetici" || gerekli.includes(baglam.rol)) {
      return true;
    }
    throw new ForbiddenException("Bu işlem için yetkiniz yok");
  }
}
