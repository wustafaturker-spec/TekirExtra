import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { DuzeltmelerService } from "./duzeltmeler.service";
import { nabizla } from "../core/nabiz/nabiz";
import { firmaListesiAl, taranacakFirmalar } from "../core/aktif-firmalar";

const ON_BES_DAKIKA_MS = 15 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Worker içinde düzeltme dedektörlerini çalıştırır: aktif firmalarda en geç 15
 * dakikada bir, pasif firmalarda saatte bir (BLD-11 kuralı, `core/aktif-firmalar`).
 */
@Injectable()
export class DuzeltmeTaramaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuzeltmeTaramaZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;
  private aralikMs = ON_BES_DAKIKA_MS;

  constructor(private readonly duzeltmeler: DuzeltmelerService, private readonly metrics: MetricsService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("duzeltme-tarama-zamanlayici", () => this.calistir()));
    const ayar = Number(process.env.DUZELTME_TARAMA_INTERVAL_MS || ON_BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : ON_BES_DAKIKA_MS, ON_BES_DAKIKA_MS);
    this.aralikMs = aralik;
    this.zamanlayici = setInterval(() => void nabizla("duzeltme-tarama-zamanlayici", () => this.calistir(), aralik), aralik);
    this.logger.log(JSON.stringify({ event: "correction_scan_scheduled", intervalMs: aralik }));
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private tenantIdleriAl(): Promise<{ tumu: string[]; aktifler: Set<string> }> {
    return firmaListesiAl("Otomatik düzeltme taraması");
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const baslangic = Date.now();
    try {
      let bulunan = 0; let otomatikCozulen = 0; let basarisizTenant = 0;
      const firmalar = await this.tenantIdleriAl();
      const secim = taranacakFirmalar(firmalar.tumu, firmalar.aktifler, this.aralikMs);
      const tenantIdleri = secim.taranacak;
      for (const tenantId of tenantIdleri) {
        // PLT-05: askıdaki firmada düzeltme kaydı üretilmez.
        if (await this.erisim?.otomasyonDurdu(tenantId, "donem_kapatma")) continue;
        try {
          const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.duzeltmeler.tara());
          bulunan += sonuc.bulunan; otomatikCozulen += sonuc.otomatikCozulen;
          // BLD-13: sınıra ulaşan kaynak; o kaynağın kayıtları bu turda otomatik çözülmedi.
          for (const kaynak of sonuc.kesikKaynaklar ?? []) this.metrics.increment("correction_scan_truncated_total", { kaynak });
          if (sonuc.kesikKaynaklar?.length) this.logger.warn(JSON.stringify({ event: "correction_scan_truncated", tenantId, kaynaklar: sonuc.kesikKaynaklar }));
          this.metrics.increment("correction_scan_tenant_total", { result: "success" });
        } catch (hata) {
          basarisizTenant++;
          this.metrics.increment("correction_scan_tenant_total", { result: "failed" });
          this.logger.error(JSON.stringify({ event: "correction_scan_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
      const sureMs = Date.now() - baslangic;
      this.metrics.increment("correction_scan_runs_total", { result: basarisizTenant ? "partial" : "success" });
      this.metrics.increment("correction_findings_total", {}, bulunan);
      this.metrics.increment("correction_auto_resolutions_total", {}, otomatikCozulen);
      this.metrics.set("correction_scan_duration_seconds", sureMs / 1000);
      this.metrics.set("correction_scan_tenants", tenantIdleri.length);
      this.metrics.set("correction_scan_failed_tenants", basarisizTenant);
      if (!basarisizTenant) this.metrics.set("correction_scan_last_success_timestamp_seconds", Math.floor(Date.now() / 1000));
      this.logger.debug(JSON.stringify({ event: "correction_scan_completed", tenantCount: tenantIdleri.length, aktif: secim.aktif, pasifTaranan: secim.pasifTaranan, atlanan: secim.atlanan, failedTenantCount: basarisizTenant, findings: bulunan, autoResolutions: otomatikCozulen, durationMs: sureMs }));
    } catch (hata) {
      this.metrics.increment("correction_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "correction_scan_failed", durationMs: Date.now() - baslangic, error: hata instanceof Error ? hata.message : String(hata) }), hata instanceof Error ? hata.stack : undefined);
    } finally { this.calisiyor = false; }
  }
}
