import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { AbonelikOdemeService } from "./abonelik-odeme.service";
import { nabizla } from "../core/nabiz/nabiz";

const BIR_SAAT_MS = 60 * 60 * 1000;

/**
 * PLT-14: otomatik yenileme zamanlayıcısı. Yalnız worker'da, saatlik. Aday
 * listesi platform işlevinden gelir (otomatik yenilemesi açık, aktif/denemedeki,
 * dönemi 3 gün içinde biten firmalar; askıdaki ve iptaldeki firma girmez); her
 * firma kendi kiracı bağlamında işlenir. Günde bir / dönem başına üç deneme
 * kuralını kart satırındaki atomik sayaç uygular.
 */
@Injectable()
export class OtomatikYenilemeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtomatikYenilemeService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly odeme: AbonelikOdemeService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    setImmediate(() => void nabizla("otomatik-yenileme", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("otomatik-yenileme", () => this.calistir()), BIR_SAAT_MS);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  async calistir(): Promise<Record<string, number>> {
    const sayim: Record<string, number> = { odendi: 0, bekliyor: 0, basarisiz: 0, atlandi: 0, hata: 0 };
    if (this.calisiyor) return sayim;
    this.calisiyor = true;
    try {
      const adaylar = await this.platform.db.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM platform_otomatik_yenileme_adaylari()`;
      for (const a of adaylar) {
        try {
          sayim[await this.odeme.otomatikYenile(a.tenant_id)]++;
        } catch (hata) {
          sayim.hata++;
          this.logger.error(JSON.stringify({ event: "billing_auto_renewal_error", tenantId: a.tenant_id, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
      if (sayim.odendi || sayim.basarisiz || sayim.bekliyor || sayim.hata) this.logger.log(JSON.stringify({ event: "billing_auto_renewal_run", ...sayim }));
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "billing_auto_renewal_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      this.calisiyor = false;
    }
    return sayim;
  }
}
