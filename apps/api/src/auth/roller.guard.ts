import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ozelRolIstegiKapali, type Rol } from "@tekirextra/shared";
import { baglamAl } from "../core/istek-baglami";
import { DESTEK_OTURUMUNDA_ACIK_ANAHTAR, OZEL_ROLDE_YAZMA_KAPALI_ANAHTAR, SALT_OKUMA_ANAHTAR } from "./public.decorator";
import { ROLLER_ANAHTAR } from "./roller.decorator";

/** Çalışan ve B2B bayinin @Roller'da adı geçmeyen uçlardan yalnız erişebildiği hesap uçları. */
export const CALISAN_ACIK_YOLLAR = ["/auth/ben", "/auth/totp", "/auth/cikis", "/auth/parola", "/auth/oturumlar", "/bildirimler", "/istemci-hata"];

/**
 * Firma içi geniş erişimi olmayan roller: çalışan (PRS-21, yalnız kendi
 * kartı) ve B2B bayi (firmanın müşterisi, yalnız kendi cari hesabı). Rol
 * kısıtı olmayan genel uçlar (cari, fatura, stok listeleri…) onlara kapalıdır.
 */
const DAR_ROLLER: readonly Rol[] = ["calisan", "b2b_bayi"];

/**
 * Bir rolün `@Roller` listesi verilen uca erişip erişemeyeceği. Dar roller
 * yalnız adlarının açıkça geçtiği uçlara girer; hesap yolu istisnaları
 * guard'dadır. Yapay zekâ araçları da ucu bu kuralla denetler (AI-02).
 */
export function rolUcaYetkili(rol: Rol, gerekli: Rol[] | undefined): boolean {
  if (DAR_ROLLER.includes(rol)) return Boolean(gerekli?.includes(rol));
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
    // PRS-21 / B2B: çalışan ve bayi yalnız adlarının açıkça geçtiği uçlara ve
    // hesaplarının oturum/bildirim uçlarına erişir; @Roller taşımayan genel uçlar onlara kapalı.
    if (baglam && DAR_ROLLER.includes(baglam.rol)) {
      if (gerekli?.includes(baglam.rol)) return true;
      // Açık hesap yollarının altında başka rollere ayrılmış uç (ör. bildirim taraması) açılmaz.
      if (gerekli?.length) throw new ForbiddenException("Bu işlem için yetkiniz yok");
      const yol = String(context.switchToHttp().getRequest<{ path?: string }>()?.path ?? "").replace(/^\/api\/v\d+/, "");
      if (CALISAN_ACIK_YOLLAR.some((onek) => yol === onek || yol.startsWith(`${onek}/`))) return true;
      throw new ForbiddenException("Bu işlem için yetkiniz yok");
    }
    if (!baglam) return true; // @Public uçlar — AuthGuard zaten karar verdi
    if (!rolUcaYetkili(baglam.rol, gerekli)) throw new ForbiddenException("Bu işlem için yetkiniz yok");
    // Rol ve kullanıcı yönetimi tam yetki ister: özel rol kendini ya da başkasını yükseltip kutuları aşamaz.
    if (baglam.ozelRol && this.reflector.getAllAndOverride<boolean>(OZEL_ROLDE_YAZMA_KAPALI_ANAHTAR, [context.getHandler(), context.getClass()])) {
      const { method } = context.switchToHttp().getRequest<{ method: string }>();
      if (method !== "GET" && method !== "HEAD") throw new ForbiddenException("Rol ve kullanıcı yönetimi özel rolde kapalıdır");
    }
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
