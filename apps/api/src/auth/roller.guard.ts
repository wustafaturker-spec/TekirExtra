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

/** Rol denetimi (KLN-02): @Roller listesi + yonetici her zaman geçer. */
@Injectable()
export class RollerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const gerekli = this.reflector.getAllAndOverride<Rol[] | undefined>(
      ROLLER_ANAHTAR,
      [context.getHandler(), context.getClass()],
    );
    if (!gerekli || gerekli.length === 0) return true;

    const baglam = baglamAl();
    if (!baglam) return true; // @Public uçlar — AuthGuard zaten karar verdi

    if (baglam.rol === "yonetici" || gerekli.includes(baglam.rol)) {
      return true;
    }
    throw new ForbiddenException("Bu işlem için yetkiniz yok");
  }
}
