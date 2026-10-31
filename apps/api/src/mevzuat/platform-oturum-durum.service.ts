import { Injectable } from "@nestjs/common";
import type { PlatformRol } from "@prisma/client";
import { PlatformPrismaService } from "./platform-prisma.service";

/** Önbellek süresi: başka API süreçlerinde iptal ve yetki değişikliği en geç bu kadar sonra etkili olur. */
export const PLATFORM_DURUM_ONBELLEK_MS = 10_000;

export interface PlatformKullaniciDurumu { aktif: boolean; rol: PlatformRol; oturumSurumu: number }

/**
 * PLT-25: guard'ın platform kullanıcısı ve oturum durumunu okuduğu tek yer.
 * Her süreç 10 sn önbellek tutar; aynı süreçte yapılan iptal/sürüm artışı
 * `unut` ile hemen etkili olur, diğer süreçlerde en geç 10 sn sürer.
 */
@Injectable()
export class PlatformOturumDurumService {
  private readonly kullanicilar = new Map<string, PlatformKullaniciDurumu & { bitis: number }>();
  private readonly oturumlar = new Map<string, { gecerli: boolean; bitis: number }>();

  constructor(private readonly platform: PlatformPrismaService) {}

  /** Pasif, kurulum bekleyen (davet/2FA sıfırlaması) ya da bulunamayan hesap aktif sayılmaz. */
  async kullanici(id: string, taze = false): Promise<PlatformKullaniciDurumu> {
    const simdi = Date.now();
    const k = this.kullanicilar.get(id);
    if (!taze && k && k.bitis > simdi) return k;
    const kayit = await this.platform.db.platformKullanici.findUnique({ where: { id }, select: { aktif: true, rol: true, davetTuru: true, oturumSurumu: true } });
    const durum: PlatformKullaniciDurumu = { aktif: Boolean(kayit?.aktif) && !kayit?.davetTuru, rol: kayit?.rol ?? "mevzuat_editoru", oturumSurumu: kayit?.oturumSurumu ?? -1 };
    if (this.kullanicilar.size > 1_000) this.kullanicilar.clear();
    this.kullanicilar.set(id, { ...durum, bitis: simdi + PLATFORM_DURUM_ONBELLEK_MS });
    return durum;
  }

  /** Oturum kaydı var, iptal edilmemiş ve süresi dolmamış mı? */
  async oturumGecerli(oid: string, kullaniciId: string): Promise<boolean> {
    const simdi = Date.now();
    const o = this.oturumlar.get(oid);
    if (o && o.bitis > simdi) return o.gecerli;
    const kayit = await this.platform.db.platformOturum.findUnique({ where: { id: oid }, select: { kullaniciId: true, iptalAt: true, bitis: true } });
    const gecerli = Boolean(kayit && kayit.kullaniciId === kullaniciId && !kayit.iptalAt && kayit.bitis.getTime() > simdi);
    if (this.oturumlar.size > 5_000) this.oturumlar.clear();
    this.oturumlar.set(oid, { gecerli, bitis: simdi + PLATFORM_DURUM_ONBELLEK_MS });
    return gecerli;
  }

  kullaniciUnut(id: string): void { this.kullanicilar.delete(id); }
  oturumUnut(oid: string): void { this.oturumlar.delete(oid); }
}
