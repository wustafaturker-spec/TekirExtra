import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { bugunTR } from "@tekirextra/shared";
import { nabizla } from "../core/nabiz/nabiz";
import { PlatformPrismaService } from "./platform-prisma.service";
import { PlatformIstatistikService } from "./platform-istatistik.service";
import { gunEkle } from "./platform-istatistik-filtre";

@Injectable()
export class PlatformIstatistikZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformIstatistikZamanlayiciService.name);
  private ilk?: NodeJS.Immediate;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;
  private kapandi = false;
  constructor(private readonly platform: PlatformPrismaService, private readonly istatistik: PlatformIstatistikService) {}
  onModuleInit() {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    this.ilk = setImmediate(() => void nabizla("platform-firma-istatistik", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("platform-firma-istatistik", () => this.calistir(), 10 * 60 * 1000), 10 * 60 * 1000);
  }
  onModuleDestroy() { this.kapandi = true; if (this.ilk) clearImmediate(this.ilk); if (this.zamanlayici) clearInterval(this.zamanlayici); }
  async calistir() {
    if (this.calisiyor || this.kapandi) return;
    this.calisiyor = true;
    try {
      // Geçmiş gün yeniden hesaplamasından bağımsız; yalnız mevcut anı kaydeder.
      if (!await this.istatistik.operasyonGozle()) this.logger.warn("Operasyon gözlemi başka worker tarafından üretiliyor.");
      const bugun = bugunTR();
      const onceki = gunEkle(bugun, -1);
      const adaylar = await this.platform.db.$queryRaw<{ gun: string }[]>`
        SELECT d::date::text AS gun FROM platform_istatistik_ayari a
        CROSS JOIN LATERAL generate_series(greatest(a.baslangic, ${gunEkle(bugun, -7)}::date), ${bugun}::date, interval '1 day') d
        LEFT JOIN platform_istatistik_gunleri g ON g.gun = d::date
        WHERE a.id = 1 AND (g.gun IS NULL OR g.surum <> 1 OR d::date >= ${onceki}::date) ORDER BY d`;
      for (const aday of adaylar) {
        if (this.kapandi) break;
        await this.istatistik.gunuUret(aday.gun);
      }
    } catch (e) {
      this.logger.error(`Firma istatistikleri üretilemedi: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally { this.calisiyor = false; }
  }
}
