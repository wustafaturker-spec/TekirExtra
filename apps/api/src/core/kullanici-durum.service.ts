import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export interface KullaniciDurumu {
  aktif: boolean;
  rol: string | null;
  oturumSurumu: number;
}

/** Guard her istekte DB'ye gitmesin; değişiklik en geç bu sürede tüm süreçlere yansır. */
export const DURUM_ONBELLEK_MS = 10_000;

/**
 * Yönetim P1-2: erişim token'ı 15 dk geçerli olsa da pasife alınan, rolü
 * değişen ya da parolası/2FA'sı sıfırlanan kullanıcı en geç 10 sn içinde düşer.
 */
@Injectable()
export class KullaniciDurumService {
  private readonly onbellek = new Map<string, { durum: KullaniciDurumu; bitis: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getir(tenantId: string, userId: string, taze = false): Promise<KullaniciDurumu> {
    const simdi = Date.now();
    const kayit = this.onbellek.get(userId);
    if (!taze && kayit && kayit.bitis > simdi) return kayit.durum;
    const k = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { aktif: true, rol: true, oturumSurumu: true } }),
    );
    const durum: KullaniciDurumu = k ? { aktif: k.aktif, rol: k.rol, oturumSurumu: k.oturumSurumu } : { aktif: false, rol: null, oturumSurumu: -1 };
    if (this.onbellek.size > 10_000) this.onbellek.clear();
    this.onbellek.set(userId, { durum, bitis: simdi + DURUM_ONBELLEK_MS });
    return durum;
  }

  /** Bu süreçte yapılan değişiklik beklemeden görünsün. */
  unut(userId: string): void {
    this.onbellek.delete(userId);
  }
}
