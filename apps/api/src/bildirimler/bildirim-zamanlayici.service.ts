import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { nabizla } from "../core/nabiz/nabiz";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const SAAT_MS = 60 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
/** BLD-11: son bu kadar günde girişi ya da kaydı olan firma aktif sayılır. */
export const AKTIF_FIRMA_GUN = 7;

/** Firma kimliğinden kararlı dilim; pasif firmalar saate eşit yayılır. */
export function firmaDilimi(tenantId: string, dilimSayisi: number): number {
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
  return h % dilimSayisi;
}

/**
 * BLD-11: bu çalışmada taranacak firmalar. Aktifler her çalışmada; pasifler
 * yalnız kendi diliminde (aralık 5 dk ise 12 dilim → saatte bir).
 */
export function taranacakFirmalar(tumu: string[], aktifler: ReadonlySet<string>, aralikMs: number, simdiMs = Date.now()): { taranacak: string[]; aktif: number; pasifTaranan: number; atlanan: number } {
  const dilimSayisi = Math.max(1, Math.round(SAAT_MS / aralikMs));
  const dilim = Math.floor(simdiMs / aralikMs) % dilimSayisi;
  const taranacak: string[] = []; let aktif = 0; let pasifTaranan = 0;
  for (const id of tumu) {
    if (aktifler.has(id)) { aktif++; taranacak.push(id); }
    else if (firmaDilimi(id, dilimSayisi) === dilim) { pasifTaranan++; taranacak.push(id); }
  }
  return { taranacak, aktif, pasifTaranan, atlanan: tumu.length - taranacak.length };
}

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

  /** Tüm firmalar ve aktif olanlar (son AKTIF_FIRMA_GUN günde giriş ya da kayıt). */
  private async tenantIdleriAl(): Promise<{ tumu: string[]; aktifler: Set<string> }> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Bildirim taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    const sinir = new Date(Date.now() - AKTIF_FIRMA_GUN * 24 * SAAT_MS);
    try {
      const [tenantlar, girisler] = await Promise.all([
        yonetim.tenant.findMany({ select: { id: true, createdAt: true } }),
        yonetim.user.findMany({ where: { sonGirisAt: { gte: sinir } }, select: { tenantId: true }, distinct: ["tenantId"] }),
      ]);
      const aktifler = new Set(girisler.map((g) => g.tenantId));
      for (const t of tenantlar) if (t.createdAt >= sinir) aktifler.add(t.id);
      return { tumu: tenantlar.map((t) => t.id), aktifler };
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
