import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Worker içinde tüm tenantların bildirim taramasını ve bekleyen e-posta
 * teslimatlarını çalıştırır (BLD-10). Düzeltme taramasıyla aynı desendedir;
 * bir tenantın hatası diğerlerini durdurmaz.
 */
@Injectable()
export class BildirimZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BildirimZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly uretici: BildirimUreticiService,
    private readonly eposta: BildirimEpostaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void this.calistir());
    const ayar = Number(process.env.BILDIRIM_TARAMA_INTERVAL_MS || BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : BES_DAKIKA_MS, BES_DAKIKA_MS);
    this.zamanlayici = setInterval(() => void this.calistir(), aralik);
    this.logger.log(JSON.stringify({ event: "notification_scan_scheduled", intervalMs: aralik }));
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Bildirim taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try {
      return (await yonetim.tenant.findMany({ select: { id: true } })).map((tenant) => tenant.id);
    } finally {
      await yonetim.$disconnect();
    }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const baslangic = Date.now();
    try {
      let uretilen = 0;
      let teslimat = 0;
      let gonderilen = 0;
      let basarisizTenant = 0;
      const tenantIdleri = await this.tenantIdleriAl();
      for (const tenantId of tenantIdleri) {
        try {
          const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, async () => {
            const tarama = await this.uretici.tara();
            const posta = await this.eposta.bekleyenleriGonder();
            return { tarama, posta };
          });
          uretilen += sonuc.tarama.uretilen;
          teslimat += sonuc.tarama.yeniTeslimat;
          gonderilen += sonuc.posta.gonderilen;
          this.metrics.increment("notification_scan_tenant_total", { result: "success" });
        } catch (hata) {
          basarisizTenant++;
          this.metrics.increment("notification_scan_tenant_total", { result: "failed" });
          this.logger.error(JSON.stringify({ event: "notification_scan_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
      const sureMs = Date.now() - baslangic;
      this.metrics.increment("notification_scan_runs_total", { result: basarisizTenant ? "partial" : "success" });
      this.metrics.increment("notification_deliveries_total", {}, teslimat);
      this.metrics.increment("notification_emails_sent_total", {}, gonderilen);
      this.metrics.set("notification_scan_duration_seconds", sureMs / 1000);
      this.metrics.set("notification_scan_tenants", tenantIdleri.length);
      this.logger.log(JSON.stringify({ event: "notification_scan_completed", tenants: tenantIdleri.length, uretilen, teslimat, gonderilen, basarisizTenant, sureMs }));
    } catch (hata) {
      this.metrics.increment("notification_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "notification_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      this.calisiyor = false;
    }
  }
}
