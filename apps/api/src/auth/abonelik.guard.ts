import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { baglamAl } from "../core/istek-baglami";
import { SALT_OKUMA_ANAHTAR } from "./public.decorator";

const YAZMA = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Salt okunur firmada da yazılabilen yollar: oturum, abonelik (yeniden etkinleştirme/talep), kişisel bildirim, ölçüm. */
const ACIK_ONEKLER = ["/auth/", "/abonelik/", "/bildirimler/", "/kullanim/olay"];

/**
 * Platform P0-1: askıdaki ya da iptal dönemi bitmiş firmada veri değiştiren
 * istekler reddedilir; görüntüleme ve dışa aktarma açık kalır (veriler firmanındır).
 */
@Injectable()
export class AbonelikGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly erisim: AbonelikErisimService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const baglam = baglamAl();
    if (!baglam) return true; // @Public ve platform uçları
    const istek = context.switchToHttp().getRequest<{ method: string; path?: string }>();
    if (!YAZMA.has(istek.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SALT_OKUMA_ANAHTAR, [context.getHandler(), context.getClass()])) return true;
    const yol = String(istek.path ?? "").replace(/^\/api\/v\d+/, "");
    if (ACIK_ONEKLER.some((o) => yol.startsWith(o) || `${yol}/` === o)) return true;
    const e = await this.erisim.getir(baglam.tenantId);
    if (e.kisitli) throw new ForbiddenException(e.neden ?? "Abonelik salt okunur");
    return true;
  }
}
