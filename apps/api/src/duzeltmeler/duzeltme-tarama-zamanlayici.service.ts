import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { DuzeltmelerService } from "./duzeltmeler.service";
import { nabizla } from "../core/nabiz/nabiz";
import { degismeyenleriAyikla, firmaListesiAl, taranacakFirmalar } from "../core/aktif-firmalar";
import { sonDegisimler, TaramaDurumu, taramaYazimiyla } from "../core/degisim-izi";
import { TaramaKuyrugu, taramaKuyruguEtkin } from "../core/tarama-kuyrugu";
import { SISTEM_USER_ID } from "../core/sistem-kimligi";

const ON_BES_DAKIKA_MS = 15 * 60 * 1000;

/**
 * Worker içinde düzeltme dedektörlerini çalıştırır: aktif firmalarda en geç 15
 * dakikada bir, pasif firmalarda saatte bir (BLD-11 kuralı, `core/aktif-firmalar`).
 */
/** BLD-15: tam stok tutarlılık denetimi her gün bu saatten (İstanbul) sonraki ilk taramada yapılır. */
export const STOK_TAM_DENETIM_SAATI = 3;
const ISTANBUL_MS = 3 * 3_600_000;
/** BLD-15: artımlı denetimde son taramadan bu kadar önceye bakılır (saat/kesinleşme farkı payı). */
export const STOK_DEGISIM_PAYI_MS = 5 * 60_000;

/** Bugünün (İstanbul) tam denetim anı geçtiyse o an, geçmediyse dünkü. */
export function sonTamDenetimSiniri(simdiMs: number): number {
  const yerel = new Date(simdiMs + ISTANBUL_MS);
  const sinir = Date.UTC(yerel.getUTCFullYear(), yerel.getUTCMonth(), yerel.getUTCDate(), STOK_TAM_DENETIM_SAATI) - ISTANBUL_MS;
  return sinir <= simdiMs ? sinir : sinir - 86_400_000;
}

/**
 * BLD-15: artımlı denetimin başlangıcı; tam denetim gerekiyorsa undefined.
 * Tam: firma bu süreçte hiç taranmadıysa ya da son tam denetim son 03:00'ten önceyse.
 */
export function stokDenetimBaslangici(sonTarama: number | undefined, sonTam: number | undefined, simdiMs: number): Date | undefined {
  if (sonTarama === undefined || sonTam === undefined || sonTam < sonTamDenetimSiniri(simdiMs)) return undefined;
  return new Date(sonTarama - STOK_DEGISIM_PAYI_MS);
}

/** BLD-17: firma işi. */
export interface DuzeltmeFirmaIsi { tenantId: string }
const NABIZ_ADI = "duzeltme-tarama-zamanlayici";

/**
 * BLD-17: varsayılan olarak firma başına kuyruk işiyle (birden çok worker
 * güvenle paylaşır); kuyruk kapalıysa (test, `TARAMA_KUYRUGU_KAPALI=1`) bu
 * süreçte sırayla.
 */
@Injectable()
export class DuzeltmeTaramaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuzeltmeTaramaZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private kuyruk?: TaramaKuyrugu<DuzeltmeFirmaIsi>;
  /** BLD-14/17: firmanın son başarılı taramasının başlangıcı (Redis'te, worker'lar arasında ortak). */
  private readonly sonTaramalar = new TaramaDurumu("duzeltme");
  /** BLD-15/17: firmanın son tam stok tutarlılık denetiminin başlangıcı. */
  private readonly sonStokTam = new TaramaDurumu("stok-tam");
  private calisiyor = false;
  private aralikMs = ON_BES_DAKIKA_MS;

  constructor(private readonly duzeltmeler: DuzeltmelerService, private readonly metrics: MetricsService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    const ayar = Number(process.env.DUZELTME_TARAMA_INTERVAL_MS || ON_BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : ON_BES_DAKIKA_MS, ON_BES_DAKIKA_MS);
    this.aralikMs = aralik;
    if (taramaKuyruguEtkin()) {
      this.kuyruk = new TaramaKuyrugu<DuzeltmeFirmaIsi>({ tur: "duzeltme", nabizAdi: NABIZ_ADI, aralikMs: aralik, planla: () => this.planla(), isle: (is) => this.firmaIsle(is).then((s) => {
        // Kuyrukta "tur" yoktur; başarılı her firma işi son başarı anını tazeler.
        if (s?.basarili) this.metrics.set("correction_scan_last_success_timestamp_seconds", Math.floor(Date.now() / 1000));
      }) });
      void this.kuyruk.baslat().catch((hata) => this.logger.error(JSON.stringify({ event: "correction_scan_queue_failed", error: hata instanceof Error ? hata.message : String(hata) })));
      return;
    }
    setImmediate(() => void nabizla(NABIZ_ADI, () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla(NABIZ_ADI, () => this.calistir(), aralik), aralik);
    this.logger.log(JSON.stringify({ event: "correction_scan_scheduled", intervalMs: aralik }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    await this.kuyruk?.kapat();
  }

  private tenantIdleriAl(): Promise<{ tumu: string[]; aktifler: Set<string> }> {
    return firmaListesiAl("Otomatik düzeltme taraması");
  }

  /** BLD-11/14: bu turda taranacak firmalar (son taramadan beri yazmayan, saatlik zorunlu dışında atlanır). */
  async planla(): Promise<DuzeltmeFirmaIsi[]> {
    const firmalar = await this.tenantIdleriAl();
    const secim = taranacakFirmalar(firmalar.tumu, firmalar.aktifler, this.aralikMs);
    const degisim = degismeyenleriAyikla(secim.taranacak, await this.sonTaramalar.oku(secim.taranacak), await sonDegisimler(secim.taranacak), this.aralikMs);
    this.metrics.set("correction_scan_tenants", degisim.taranacak.length);
    this.metrics.set("correction_scan_unchanged_tenants", degisim.degismeyen);
    this.logger.debug(JSON.stringify({ event: "correction_scan_planned", tenantCount: degisim.taranacak.length, aktif: secim.aktif, pasifTaranan: secim.pasifTaranan, atlanan: secim.atlanan, degismeyen: degisim.degismeyen }));
    return degisim.taranacak.map((tenantId) => ({ tenantId }));
  }

  /** Tek firma. Hata loglanır, fırlatılmaz; askıdaki firma atlanır (null). */
  async firmaIsle({ tenantId }: DuzeltmeFirmaIsi): Promise<{ bulunan: number; otomatikCozulen: number; stok: "tam" | "artimli"; basarili: boolean } | null> {
    // PLT-05: askıdaki firmada düzeltme kaydı üretilmez.
    if (await this.erisim?.otomasyonDurdu(tenantId, "donem_kapatma")) return null;
    try {
      const taramaBasi = Date.now();
      const [sonTarama, sonTam] = await Promise.all([this.sonTaramalar.oku([tenantId]), this.sonStokTam.oku([tenantId])]);
      const stokDegisimSonrasi = stokDenetimBaslangici(sonTarama.get(tenantId), sonTam.get(tenantId), taramaBasi);
      const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => taramaYazimiyla(() => this.duzeltmeler.tara({ stokDegisimSonrasi })));
      await this.sonTaramalar.yaz(tenantId, taramaBasi);
      if (!stokDegisimSonrasi) await this.sonStokTam.yaz(tenantId, taramaBasi);
      // BLD-13: sınıra ulaşan kaynak; o kaynağın kayıtları bu turda otomatik çözülmedi.
      for (const kaynak of sonuc.kesikKaynaklar ?? []) this.metrics.increment("correction_scan_truncated_total", { kaynak });
      if (sonuc.kesikKaynaklar?.length) this.logger.warn(JSON.stringify({ event: "correction_scan_truncated", tenantId, kaynaklar: sonuc.kesikKaynaklar }));
      this.metrics.increment("correction_scan_tenant_total", { result: "success" });
      this.metrics.increment("correction_findings_total", {}, sonuc.bulunan);
      this.metrics.increment("correction_auto_resolutions_total", {}, sonuc.otomatikCozulen);
      return { bulunan: sonuc.bulunan, otomatikCozulen: sonuc.otomatikCozulen, stok: sonuc.stokDenetimi?.tur === "artimli" ? "artimli" : "tam", basarili: true };
    } catch (hata) {
      this.metrics.increment("correction_scan_tenant_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "correction_scan_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
      return { bulunan: 0, otomatikCozulen: 0, stok: "tam", basarili: false };
    }
  }

  /** Kuyruksuz mod (test, `TARAMA_KUYRUGU_KAPALI=1`): turu bu süreçte sırayla çalıştırır. */
  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const baslangic = Date.now();
    try {
      let bulunan = 0; let otomatikCozulen = 0; let basarisizTenant = 0; let tamStok = 0; let artimliStok = 0;
      const isler = await this.planla();
      for (const is of isler) {
        const s = await this.firmaIsle(is);
        if (!s) continue;
        bulunan += s.bulunan; otomatikCozulen += s.otomatikCozulen;
        if (!s.basarili) basarisizTenant++; else if (s.stok === "tam") tamStok++; else artimliStok++;
      }
      const sureMs = Date.now() - baslangic;
      this.metrics.increment("correction_scan_runs_total", { result: basarisizTenant ? "partial" : "success" });
      this.metrics.set("correction_scan_duration_seconds", sureMs / 1000);
      this.metrics.set("correction_scan_failed_tenants", basarisizTenant);
      if (!basarisizTenant) this.metrics.set("correction_scan_last_success_timestamp_seconds", Math.floor(Date.now() / 1000));
      this.logger.debug(JSON.stringify({ event: "correction_scan_completed", tenantCount: isler.length, stokTam: tamStok, stokArtimli: artimliStok, failedTenantCount: basarisizTenant, findings: bulunan, autoResolutions: otomatikCozulen, durationMs: sureMs }));
    } catch (hata) {
      this.metrics.increment("correction_scan_runs_total", { result: "failed" });
      this.logger.error(JSON.stringify({ event: "correction_scan_failed", durationMs: Date.now() - baslangic, error: hata instanceof Error ? hata.message : String(hata) }), hata instanceof Error ? hata.stack : undefined);
    } finally { this.calisiyor = false; }
  }
}
