import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { nabizla } from "../core/nabiz/nabiz";
import { firmaListesiAl, taranacakFirmalar } from "../core/aktif-firmalar";

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
  private aralikMs = BES_DAKIKA_MS;

  constructor(
    private readonly uretici: BildirimUreticiService,
    private readonly eposta: BildirimEpostaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("bildirim-zamanlayici", () => this.calistir()));
    const ayar = Number(process.env.BILDIRIM_TARAMA_INTERVAL_MS || BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : BES_DAKIKA_MS, BES_DAKIKA_MS);
    this.aralikMs = aralik;
    this.zamanlayici = setInterval(() => void nabizla("bildirim-zamanlayici", () => this.calistir()), aralik);
    this.logger.log(JSON.stringify({ event: "notification_scan_scheduled", intervalMs: aralik }));
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private tenantIdleriAl(): Promise<{ tumu: string[]; aktifler: Set<string> }> {
    return firmaListesiAl("Bildirim taraması");
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
      const firmalar = await this.tenantIdleriAl();
      const secim = taranacakFirmalar(firmalar.tumu, firmalar.aktifler, this.aralikMs);
      const tenantIdleri = secim.taranacak;
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
      this.logger.log(JSON.stringify({ event: "notification_scan_completed", tenants: tenantIdleri.length, aktif: secim.aktif, pasifTaranan: secim.pasifTaranan, atlanan: secim.atlanan, uretilen, teslimat, gonderilen, basarisizTenant, sureMs }));
    } catch (hata) {
      this.metrics.increment("notification_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "notification_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      this.calisiyor = false;
    }
  }
}
