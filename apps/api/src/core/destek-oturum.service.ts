import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Değişiklik en geç bu sürede bütün süreçlere yansır (KullaniciDurumService ile aynı). */
export const DESTEK_DURUM_ONBELLEK_MS = 10_000;

/**
 * PLT-10: destek token'ı yalnız oturum açıkken, süresi dolmamışken ve firmanın
 * izni geri alınmamışken geçer. İzin geri alınınca ya da oturum kapatılınca
 * eldeki token en geç 10 sn içinde düşer.
 */
@Injectable()
export class DestekOturumService {
  private readonly onbellek = new Map<string, { etkin: boolean; bitis: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async etkinMi(tenantId: string, oturumId: string): Promise<boolean> {
    const simdi = Date.now();
    const kayit = this.onbellek.get(oturumId);
    if (kayit && kayit.bitis > simdi) return kayit.etkin;
    const sayi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.destekOturumu.count({
        where: { id: oturumId, kapanis: null, bitis: { gt: new Date() }, izin: { geriAlindiAt: null, bitis: { gt: new Date() } } },
      }),
    );
    if (this.onbellek.size > 1_000) this.onbellek.clear();
    this.onbellek.set(oturumId, { etkin: sayi > 0, bitis: simdi + DESTEK_DURUM_ONBELLEK_MS });
    return sayi > 0;
  }

  /** Firma kullanıcılarının "TekirExtra desteği bağlı" işareti. */
  async bagliMi(tenantId: string): Promise<boolean> {
    const sayi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.destekOturumu.count({ where: { kapanis: null, bitis: { gt: new Date() }, izin: { geriAlindiAt: null, bitis: { gt: new Date() } } } }),
    );
    return sayi > 0;
  }

  /** Bu süreçte kapatılan oturumlar beklemeden düşsün. */
  hepsiniUnut(): void {
    this.onbellek.clear();
  }
}
