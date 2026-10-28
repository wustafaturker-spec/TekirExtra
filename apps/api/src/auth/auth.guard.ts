import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { Rol } from "@tekirextra/shared";
import { DestekOturumService } from "../core/destek-oturum.service";
import { baglamKur, DESTEK_KULLANICI_ID, platformBaglamKur } from "../core/istek-baglami";
import { KullaniciDurumService, type KullaniciDurumu } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { IKI_ADIM_KURULUMU_GEREKLI } from "../core/guvenlik-politikasi";
import { DESTEK_OTURUMUNDA_ACIK_ANAHTAR, IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR, PLATFORM_ANAHTAR, PLATFORM_ROLLER_ANAHTAR, PUBLIC_ANAHTAR, type PlatformRolu } from "./public.decorator";

export interface JwtYuku {
  sub: string; // userId
  tenantId: string;
  rol: Rol;
  /** Yalnız platform token'ında "platform" (MVZ-04). */
  kapsam?: string;
  /** Yönetim P1-2: kullanıcının oturum sürümü; eski token'larda yoktur (0 sayılır). */
  sv?: number;
  /** PLT-10: destek oturumu (oturum id, destek kişisinin adı/e-postası, platform kullanıcısı). */
  destek?: { oid: string; ad: string; ep: string; pid: string };
}

/** MVZ-04: platform ekibi token'ı; kiracı token'ından ayrı anahtarla imzalanır. */
export interface PlatformJwtYuku {
  sub: string;
  eposta: string;
  kapsam: "platform";
  /** PLT-06: girişteki rol; guard güncel rolü veritabanından okur. */
  rol?: PlatformRolu;
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
    @Optional() private readonly destekDurum?: DestekOturumService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Platform P1-2 / PLT-06 / PLT-07: pasife alınan, rolü değişen ya da 2FA'sı sıfırlanan platform kullanıcısı en geç 10 sn içinde etkilenir. */
  private readonly platformDurum = new Map<string, { aktif: boolean; rol: PlatformRolu; bitis: number }>();

  private async platformKullaniciDurumu(id: string, tokenRolu: PlatformRolu | undefined): Promise<{ aktif: boolean; rol: PlatformRolu }> {
    if (!this.platformDb) return { aktif: true, rol: tokenRolu ?? "yonetici" };
    const simdi = Date.now();
    const k = this.platformDurum.get(id);
    if (k && k.bitis > simdi) return k;
    const kayit = await this.platformDb.db.platformKullanici.findUnique({ where: { id }, select: { aktif: true, rol: true, davetTuru: true } });
    // PLT-07: 2FA'sı sıfırlanıp yeniden kurulumu bekleyen hesabın eldeki token'ı da düşer.
    const durum = { aktif: Boolean(kayit?.aktif) && !kayit?.davetTuru, rol: (kayit?.rol ?? "mevzuat_editoru") as PlatformRolu };
    if (this.platformDurum.size > 1_000) this.platformDurum.clear();
    this.platformDurum.set(id, { ...durum, bitis: simdi + 10_000 });
    return durum;
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
      const durum = await this.platformKullaniciDurumu(platformYuku.sub, platformYuku.rol);
      if (!durum.aktif) throw new UnauthorizedException("Platform hesabı pasif");
      const roller = this.reflector.getAllAndOverride<PlatformRolu[] | undefined>(PLATFORM_ROLLER_ANAHTAR, [context.getHandler(), context.getClass()]);
      const izinli: PlatformRolu[] = Array.isArray(roller) ? roller : ["yonetici"];
      if (!izinli.includes(durum.rol)) throw new ForbiddenException("Bu işlem için platform yöneticisi yetkisi gerekir");
      platformBaglamKur({ kullaniciId: platformYuku.sub, eposta: platformYuku.eposta, rol: durum.rol });
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
    if (yuk.destek) return this.destekIstegi(context, istek, yuk as JwtYuku & { destek: NonNullable<JwtYuku["destek"]> });

    if (this.durum) {
      const durum = await this.guncelDurum(yuk);
      if (!durum) throw new UnauthorizedException("Oturumunuz güncel değil; yeniden giriş yapın");
      // KLN-21: zorunlu 2FA kurulmadan yalnız Hesap Güvenliği uçları açıktır.
      if (durum.ikiAdimEksik && !this.reflector.getAllAndOverride<boolean>(IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR, [context.getHandler(), context.getClass()])) {
        throw new ForbiddenException({
          statusCode: 403,
          kod: IKI_ADIM_KURULUMU_GEREKLI,
          message: "Firmanız bu rol için iki adımlı doğrulamayı zorunlu tuttu; devam etmek için Hesap Güvenliği'nden kurun.",
        });
      }
    }

    baglamKur({
      tenantId: yuk.tenantId,
      userId: yuk.sub,
      rol: yuk.rol,
    });
    return true;
  }

  /**
   * PLT-10: destek oturumu salt okunurdur (GET, ya da veri yazmayan işaretli
   * uçlar); oturum kapanınca, süresi dolunca ya da firma izni geri alınınca
   * token en geç 10 sn içinde düşer. Her istek firmanın denetim izine ve
   * platform olay kaydına destek kişisinin adıyla yazılır.
   */
  private async destekIstegi(context: ExecutionContext, istek: Request, yuk: JwtYuku & { destek: NonNullable<JwtYuku["destek"]> }): Promise<boolean> {
    if (!this.destekDurum || !this.prisma || !(await this.destekDurum.etkinMi(yuk.tenantId, yuk.destek.oid))) {
      throw new UnauthorizedException("Destek oturumu sona erdi");
    }
    const hedefler = [context.getHandler(), context.getClass()];
    // "Salt okumada açık" uçların bazıları dış servis çağırır (entegratör, test e-postası, yapay zekâ); destekte yalnız açıkça işaretlenenler.
    const okuma = istek.method === "GET" || istek.method === "HEAD"
      || Boolean(this.reflector.getAllAndOverride<boolean>(DESTEK_OTURUMUNDA_ACIK_ANAHTAR, hedefler));
    const yol = String(istek.originalUrl ?? istek.url ?? "").split("?")[0].slice(0, 300);
    const detay = { destekKisi: yuk.destek.ad, destekEposta: yuk.destek.ep, oturumId: yuk.destek.oid, yontem: istek.method, yol, reddedildi: !okuma };
    await this.prisma
      .tenantIslem(yuk.tenantId, (tx) => tx.auditLog.create({ data: { tenantId: yuk.tenantId, userId: null, islem: "destek_istegi", varlik: "destek_oturumu", varlikId: yuk.destek.oid, detay } }))
      .catch(() => undefined);
    await this.platformDb?.db.mevzuatOlay
      .create({ data: { kullaniciId: yuk.destek.pid, olay: "destek_istegi", detay: { tenantId: yuk.tenantId, ...detay } } })
      .catch(() => undefined);
    if (!okuma) throw new ForbiddenException("Destek oturumu salt okunurdur; değişiklik yapılamaz");
    baglamKur({
      tenantId: yuk.tenantId,
      userId: DESTEK_KULLANICI_ID,
      rol: "yonetici",
      destek: { oturumId: yuk.destek.oid, ad: yuk.destek.ad, eposta: yuk.destek.ep },
    });
    return true;
  }

  /** Pasif, rolü değişmiş ya da parolası/2FA'sı sıfırlanmış kullanıcının token'ı geçmez (null). */
  private async guncelDurum(yuk: JwtYuku): Promise<KullaniciDurumu | null> {
    const uyar = (d: KullaniciDurumu) =>
      d.aktif && d.rol === yuk.rol && d.oturumSurumu === (yuk.sv ?? 0);
    const onbellekte = await this.durum!.getir(yuk.tenantId, yuk.sub);
    if (uyar(onbellekte)) return onbellekte;
    // Önbellek bayat olabilir (ör. token az önce yeni sürümle yenilendi): bir kez taze oku.
    const taze = await this.durum!.getir(yuk.tenantId, yuk.sub, true);
    return uyar(taze) ? taze : null;
  }
}
