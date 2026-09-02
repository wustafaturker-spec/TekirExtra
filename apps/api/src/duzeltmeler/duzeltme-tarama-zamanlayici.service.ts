import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { DuzeltmelerService } from "./duzeltmeler.service";

const ON_BES_DAKIKA_MS = 15 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/** Worker içinde tüm tenantların düzeltme dedektörlerini en geç 15 dakikada bir çalıştırır. */
@Injectable()
export class DuzeltmeTaramaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuzeltmeTaramaZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly duzeltmeler: DuzeltmelerService, private readonly metrics: MetricsService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void this.calistir());
    const ayar = Number(process.env.DUZELTME_TARAMA_INTERVAL_MS || ON_BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : ON_BES_DAKIKA_MS, ON_BES_DAKIKA_MS);
    this.zamanlayici = setInterval(() => void this.calistir(), aralik);
    this.logger.log(JSON.stringify({ event: "correction_scan_scheduled", intervalMs: aralik }));
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Otomatik düzeltme taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((tenant) => tenant.id); }
    finally { await yonetim.$disconnect(); }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const baslangic = Date.now();
    try {
      let bulunan = 0; let otomatikCozulen = 0; const tenantIdleri = await this.tenantIdleriAl();
      for (const tenantId of tenantIdleri) {
        const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.duzeltmeler.tara());
        bulunan += sonuc.bulunan; otomatikCozulen += sonuc.otomatikCozulen;
      }
      const sureMs = Date.now() - baslangic;
      this.metrics.increment("correction_scan_runs_total", { result: "success" });
      this.metrics.increment("correction_findings_total", {}, bulunan);
      this.metrics.increment("correction_auto_resolutions_total", {}, otomatikCozulen);
      this.metrics.set("correction_scan_duration_seconds", sureMs / 1000);
      this.metrics.set("correction_scan_tenants", tenantIdleri.length);
      this.metrics.set("correction_scan_last_success_timestamp_seconds", Math.floor(Date.now() / 1000));
      this.logger.debug(JSON.stringify({ event: "correction_scan_completed", tenantCount: tenantIdleri.length, findings: bulunan, autoResolutions: otomatikCozulen, durationMs: sureMs }));
    } catch (hata) {
      this.metrics.increment("correction_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "correction_scan_failed", durationMs: Date.now() - baslangic, error: hata instanceof Error ? hata.message : String(hata) }), hata instanceof Error ? hata.stack : undefined);
    } finally { this.calisiyor = false; }
  }
}
