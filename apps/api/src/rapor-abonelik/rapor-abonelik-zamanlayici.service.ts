import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaClient } from "@prisma/client";
import { MetricsService } from "../core/observability/metrics.service";
import { RaporAbonelikService } from "./rapor-abonelik.service";
import { nabizla } from "../core/nabiz/nabiz";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const PARTI = 100;

/**
 * RPR-24: worker içinde vakti gelen rapor aboneliklerini gönderir. Bütün
 * kiracıların vakti gelmiş kayıtları yönetim bağlantısıyla bulunur; gönderim
 * her kayıt için kendi kiracısında (RLS altında) yapılır. Bir kaydın hatası
 * diğerlerini durdurmaz; gönderim sonrası `sonraki_gonderim` ilerlediği için
 * aynı kayıt bir sonraki turda yeniden seçilmez.
 */
@Injectable()
export class RaporAbonelikZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RaporAbonelikZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly servis: RaporAbonelikService, private readonly metrics: MetricsService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("rapor-abonelik-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("rapor-abonelik-zamanlayici", () => this.calistir()), BES_DAKIKA_MS);
    this.logger.log(JSON.stringify({ event: "report_subscription_scan_scheduled", intervalMs: BES_DAKIKA_MS }));
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async vaktiGelenler(): Promise<{ id: string; tenant_id: string }[]> {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) throw new Error("Rapor aboneliği taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: url });
    try {
      return await yonetim.$queryRaw<{ id: string; tenant_id: string }[]>`
        SELECT id::text, tenant_id::text FROM rapor_abonelikleri
        WHERE aktif AND sonraki_gonderim <= now() ORDER BY sonraki_gonderim LIMIT ${PARTI}`;
    } finally {
      await yonetim.$disconnect();
    }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const kayitlar = await this.vaktiGelenler();
      const sayac: Record<string, number> = {};
      for (const k of kayitlar) {
        // PLT-05: askıdaki firmanın rapor aboneliği gönderilmez; firma açılınca sıradaki vakitte gider.
        if (await this.erisim?.otomasyonDurdu(k.tenant_id)) continue;
        try {
          const sonuc = await this.servis.gonder(k.tenant_id, k.id);
          sayac[sonuc.durum] = (sayac[sonuc.durum] ?? 0) + 1;
          this.metrics.increment("report_subscription_runs_total", { result: sonuc.durum });
        } catch (hata) {
          sayac.hata = (sayac.hata ?? 0) + 1;
          this.logger.error(JSON.stringify({ event: "report_subscription_run_failed", tenantId: k.tenant_id, id: k.id, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
      if (kayitlar.length) this.logger.log(JSON.stringify({ event: "report_subscription_scan_completed", ...sayac }));
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "report_subscription_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      this.calisiyor = false;
    }
  }
}
