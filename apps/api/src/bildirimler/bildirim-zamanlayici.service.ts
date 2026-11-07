import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import { nabizla } from "../core/nabiz/nabiz";
import { degismeyenleriAyikla, firmaListesiAl, taranacakFirmalar } from "../core/aktif-firmalar";
import { sonDegisimler, TaramaDurumu, taramaYazimiyla } from "../core/degisim-izi";
import { TaramaKuyrugu, taramaKuyruguEtkin } from "../core/tarama-kuyrugu";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";
const BOS_TARAMA = { uretilen: 0, yeniTeslimat: 0, kapanan: 0, yukseltilen: 0, kesikOnekler: [] as string[] };
const NABIZ_ADI = "bildirim-zamanlayici";

/** BLD-17: firma işi. `tara` false ise firma değişmemiştir; yalnız bekleyen e-postası gönderilir (BLD-14). */
export interface BildirimFirmaIsi { tenantId: string; tara: boolean }

/**
 * Worker içinde tüm tenantların bildirim taramasını ve bekleyen e-posta
 * teslimatlarını çalıştırır (BLD-10). BLD-17: varsayılan olarak firma başına
 * kuyruk işiyle (birden çok worker güvenle paylaşır); kuyruk kapalıysa
 * (test, `TARAMA_KUYRUGU_KAPALI=1`) bu süreçte sırayla. Bir tenantın hatası
 * diğerlerini durdurmaz.
 */
@Injectable()
export class BildirimZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BildirimZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private kuyruk?: TaramaKuyrugu<BildirimFirmaIsi>;
  private calisiyor = false;
  private aralikMs = BES_DAKIKA_MS;
  /** BLD-14/17: firmanın son başarılı taramasının başlangıcı (Redis'te, worker'lar arasında ortak). */
  private readonly sonTaramalar = new TaramaDurumu("bildirim");

  constructor(
    private readonly uretici: BildirimUreticiService,
    private readonly eposta: BildirimEpostaService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    const ayar = Number(process.env.BILDIRIM_TARAMA_INTERVAL_MS || BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : BES_DAKIKA_MS, BES_DAKIKA_MS);
    this.aralikMs = aralik;
    if (taramaKuyruguEtkin()) {
      this.kuyruk = new TaramaKuyrugu<BildirimFirmaIsi>({ tur: "bildirim", nabizAdi: NABIZ_ADI, aralikMs: aralik, planla: () => this.planla(), isle: (is) => this.firmaIsle(is).then(() => undefined) });
      void this.kuyruk.baslat().catch((hata) => this.logger.error(JSON.stringify({ event: "notification_scan_queue_failed", error: hata instanceof Error ? hata.message : String(hata) })));
      return;
    }
    setImmediate(() => void nabizla(NABIZ_ADI, () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla(NABIZ_ADI, () => this.calistir(), aralik), aralik);
    this.logger.log(JSON.stringify({ event: "notification_scan_scheduled", intervalMs: aralik }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    await this.kuyruk?.kapat();
  }

  private tenantIdleriAl(): Promise<{ tumu: string[]; aktifler: Set<string> }> {
    return firmaListesiAl("Bildirim taraması");
  }

  /** BLD-11/14: bu turun firma işleri; değişmeyen firma için yalnız e-posta. */
  async planla(): Promise<BildirimFirmaIsi[]> {
    const firmalar = await this.tenantIdleriAl();
    const secim = taranacakFirmalar(firmalar.tumu, firmalar.aktifler, this.aralikMs);
    const degisim = degismeyenleriAyikla(secim.taranacak, await this.sonTaramalar.oku(secim.taranacak), await sonDegisimler(secim.taranacak), this.aralikMs);
    const taranacak = new Set(degisim.taranacak);
    this.metrics.set("notification_scan_tenants", degisim.taranacak.length);
    this.metrics.set("notification_scan_unchanged_tenants", degisim.degismeyen);
    this.logger.log(JSON.stringify({ event: "notification_scan_planned", tenants: secim.taranacak.length, aktif: secim.aktif, pasifTaranan: secim.pasifTaranan, atlanan: secim.atlanan, degismeyen: degisim.degismeyen }));
    return secim.taranacak.map((tenantId) => ({ tenantId, tara: taranacak.has(tenantId) }));
  }

  /** Tek firma: tarama (değiştiyse) + bekleyen e-postalar. Hata loglanır, fırlatılmaz. */
  async firmaIsle({ tenantId, tara }: BildirimFirmaIsi): Promise<{ uretilen: number; teslimat: number; gonderilen: number; basarili: boolean }> {
    try {
      const taramaBasi = Date.now();
      const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => taramaYazimiyla(async () => {
        const tarama = tara ? await this.uretici.tara() : BOS_TARAMA;
        const posta = await this.eposta.bekleyenleriGonder();
        return { tarama, posta };
      }));
      if (tara) await this.sonTaramalar.yaz(tenantId, taramaBasi);
      // BLD-13: sınıra takılan dedektör; o önekteki bildirimler bu turda kapatılmadı.
      for (const onek of sonuc.tarama.kesikOnekler) this.metrics.increment("notification_scan_truncated_total", { onek });
      if (sonuc.tarama.kesikOnekler.length) this.logger.warn(JSON.stringify({ event: "notification_scan_truncated", tenantId, onekler: sonuc.tarama.kesikOnekler }));
      this.metrics.increment("notification_scan_tenant_total", { result: "success" });
      this.metrics.increment("notification_deliveries_total", {}, sonuc.tarama.yeniTeslimat);
      this.metrics.increment("notification_emails_sent_total", {}, sonuc.posta.gonderilen);
      return { uretilen: sonuc.tarama.uretilen, teslimat: sonuc.tarama.yeniTeslimat, gonderilen: sonuc.posta.gonderilen, basarili: true };
    } catch (hata) {
      this.metrics.increment("notification_scan_tenant_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "notification_scan_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
      return { uretilen: 0, teslimat: 0, gonderilen: 0, basarili: false };
    }
  }

  /** Kuyruksuz mod (test, `TARAMA_KUYRUGU_KAPALI=1`): turu bu süreçte sırayla çalıştırır. */
  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const baslangic = Date.now();
    try {
      let uretilen = 0;
      let teslimat = 0;
      let gonderilen = 0;
      let basarisizTenant = 0;
      const isler = await this.planla();
      for (const is of isler) {
        const s = await this.firmaIsle(is);
        uretilen += s.uretilen; teslimat += s.teslimat; gonderilen += s.gonderilen;
        if (!s.basarili) basarisizTenant++;
      }
      const sureMs = Date.now() - baslangic;
      this.metrics.increment("notification_scan_runs_total", { result: basarisizTenant ? "partial" : "success" });
      this.metrics.set("notification_scan_duration_seconds", sureMs / 1000);
      this.logger.log(JSON.stringify({ event: "notification_scan_completed", tenants: isler.length, taranan: isler.filter((i) => i.tara).length, uretilen, teslimat, gonderilen, basarisizTenant, sureMs }));
    } catch (hata) {
      this.metrics.increment("notification_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "notification_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      this.calisiyor = false;
    }
  }
}
