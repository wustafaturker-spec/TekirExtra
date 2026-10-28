import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ozelRolIstegiKapali, type Rol } from "@tekirextra/shared";
import { baglamAl } from "../core/istek-baglami";
import { DESTEK_OTURUMUNDA_ACIK_ANAHTAR, SALT_OKUMA_ANAHTAR } from "./public.decorator";
import { ROLLER_ANAHTAR } from "./roller.decorator";

/** Çalışan rolünün @Roller("calisan") dışında erişebildiği hesap uçları. */
export const CALISAN_ACIK_YOLLAR = ["/auth/ben", "/auth/totp", "/auth/cikis", "/auth/parola", "/auth/oturumlar", "/bildirimler"];

/**
 * Bir rolün `@Roller` listesi verilen uca erişip erişemeyeceği. Çalışan rolü
 * yalnız adının açıkça geçtiği uçlara girer (PRS-21); hesap yolu istisnaları
 * guard'dadır. Yapay zekâ araçları da ucu bu kuralla denetler (AI-02).
 */
export function rolUcaYetkili(rol: Rol, gerekli: Rol[] | undefined): boolean {
  if (rol === "calisan") return Boolean(gerekli?.includes("calisan"));
  if (!gerekli || gerekli.length === 0) return true;
  return rol === "yonetici" || gerekli.includes(rol);
}

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
    if (!baglam) return true; // @Public uçlar — AuthGuard zaten karar verdi
    if (!rolUcaYetkili(baglam.rol, gerekli)) throw new ForbiddenException("Bu işlem için yetkiniz yok");
    // KLN-20: özel rol şablonun yetkisini yalnız daraltır.
    if (baglam.ozelRol?.kapali.length) {
      const istek = context.switchToHttp().getRequest<{ method: string; path?: string }>();
      const hedefler = [context.getHandler(), context.getClass()];
      const saltOkuma = Boolean(this.reflector.getAllAndOverride<boolean>(SALT_OKUMA_ANAHTAR, hedefler) || this.reflector.getAllAndOverride<boolean>(DESTEK_OTURUMUNDA_ACIK_ANAHTAR, hedefler));
      if (ozelRolIstegiKapali(baglam.ozelRol.kapali, istek.method, String(istek.path ?? ""), saltOkuma)) {
        throw new ForbiddenException("Rolünüzde bu işlem kapalı");
      }
    }
    return true;
  }
}
