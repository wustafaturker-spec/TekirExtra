import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, NotFoundException, Optional, ServiceUnavailableException, forwardRef } from "@nestjs/common";
import { DelayedError, Job, Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { uygulamaAcik, type EbelgeUygulamalari, type Rol } from "@tekirextra/shared";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { MetricsService } from "../core/observability/metrics.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { redisBaglantisi } from "../core/redis-baglantisi";
import { ebelgeUygulamalariCozTenant } from "./ebelge-uygulamalari.service";
import { EbelgeService } from "./ebelge.service";
import { EirsaliyeService, eirsaliyeSorguKosulu, eirsaliyeYenidenDenemeKosulu } from "./eirsaliye.service";
import { AZAMI_FATURA_SORGU_SURELERI, faturaSorguKosulu } from "./fatura-sorgu-kosulu";
import { nabizla } from "../core/nabiz/nabiz";

const KUYRUK_ADI = "tekirextra-ebelge";
const GONDERIM_ISI = "ebelge-gonder";
const DURUM_ISI = "ebelge-durum-sorgula";
const GELEN_ISI = "gelen-belge-cek";
const EARSIV_RAPOR_ISI = "earsiv-raporla";
const DURUM_TOPLU_ISI = "ebelge-durum-toplu";
const MUKELLEF_SENKRON_ISI = "gib-mukellef-senkron";
const EIRSALIYE_DURUM_TOPLU_ISI = "eirsaliye-durum-toplu";
/** EBLG-109: gelen e-İrsaliye taraması; eskiden yalnız elle ("Gelenleri kontrol et") yapılırdı. */
const EIRSALIYE_GELEN_ISI = "eirsaliye-gelen-cek";
const DEAD_LETTER_KUYRUGU = `${KUYRUK_ADI}-dead-letter`;
const SISTEM_KULLANICISI = "00000000-0000-0000-0000-000000000000";

export type EbelgeIsTuru =
  | typeof GONDERIM_ISI
  | typeof DURUM_ISI
  | typeof GELEN_ISI
  | typeof EARSIV_RAPOR_ISI
  | typeof DURUM_TOPLU_ISI
  | typeof MUKELLEF_SENKRON_ISI
  | typeof EIRSALIYE_DURUM_TOPLU_ISI
  | typeof EIRSALIYE_GELEN_ISI;

/**
 * Gelen belge taraması bu aralıktan sık çalışmaz. Sağlayıcı kılavuzu
 * "job sıklığı olarak minimum 1 saat ayarlanmalıdır, böylece günde toplam
 * 24 çağrıdan fazla otomatik olarak yapılmamalıdır" diyor (EBLG-11).
 */
// Kullanım anında okunur: modül yüklenirken `.env` henüz ConfigModule ile
// yüklenmemiş olur ve dosyadaki değer sessizce yok sayılırdı.
const gelenTaramaAralikMs = () => Number(process.env.EBLG_GELEN_ARALIK_MS || 60 * 60 * 1_000);

/**
 * Kiracı başına tekrarlanan işler (EBLG-98). Bunlardan biri dead-letter'a
 * düşünce eskiden süresiz duruyordu: planlayıcı da "Tazele" düğmesi de yeni
 * iş açmıyordu ve gelen kutusu bir gün boyunca sessizce güncellenmedi
 * (bağlantı pasifken düşen gelen işi, 2026-09-25). Artık kayıt bekleme
 * süresi dolunca planlayıcıca, kullanıcı isteyince hemen temizlenir.
 */
const PERIYODIK_ISLER = new Set<string>([GELEN_ISI, DURUM_TOPLU_ISI, EIRSALIYE_DURUM_TOPLU_ISI, EIRSALIYE_GELEN_ISI, MUKELLEF_SENKRON_ISI]);
/** PLT-05: askıdaki firmanın belge işi bu süre sonra yeniden denenir; deneme hakkı harcanmaz. */
const askiErtelemeMs = () => Number(process.env.EBELGE_ASKI_ERTELEME_MS || 15 * 60 * 1_000);
const deadLetterBeklemeMs = () => Number(process.env.EBELGE_DEAD_LETTER_BEKLEME_MS || 60 * 60 * 1_000);

export interface EbelgeKuyrukVerisi {
  tenantId: string;
  userId: string;
  rol: Rol;
  isTuru: EbelgeIsTuru;
  faturaId?: string;
  raporUuid?: string;
  correlationId: string;
  kuyrugaAlinmaZamani: string;
}

interface DeadLetterVerisi extends EbelgeKuyrukVerisi { asilIsId: string; hata: string; deadLetterZamani: string; }


const isKimligi = (tenantId: string, faturaId: string) => `ebelge-gonder-${tenantId}-${faturaId}`;
const durumIsKimligi = (tenantId: string, faturaId: string) => `ebelge-durum-${tenantId}-${faturaId}`;
const gelenIsKimligi = (tenantId: string) => `gelen-belge-${tenantId}`;
const earsivRaporIsKimligi = (tenantId: string, uuid: string) => `earsiv-rapor-${tenantId}-${uuid}`;
const durumTopluIsKimligi = (tenantId: string) => `ebelge-durum-toplu-${tenantId}`;
const mukellefSenkronIsKimligi = () => "gib-mukellef-senkron";
const eirsaliyeDurumTopluIsKimligi = (tenantId: string) => `eirsaliye-durum-toplu-${tenantId}`;
const eirsaliyeGelenIsKimligi = (tenantId: string) => `eirsaliye-gelen-${tenantId}`;

/**
 * GİB mükellef listesi globaldir ama bir kiracının bağlantısıyla indirilir.
 * Sağlayıcısı bu ortamda çalışmayan (üretimde mock'lu) kiracı seçilirse iş her
 * turda "atlandı" diye biter, liste eskir ve listeye dayanan kiracıların gelen
 * taraması ile gönderimi durur (pilot, 2026-10-30). Yalnız çalışan bağlantısı
 * olan kiracı seçilir.
 */
export function listeSenkronKiracisi<T extends { id: string; baglantilar: { saglayici: string }[] }>(
  tenantlar: T[],
  uygulamalar: Map<string, EbelgeUygulamalari>,
): T | undefined {
  return tenantlar.find(
    (t) => uygulamalar.get(t.id)?.efatura.acik !== false && t.baglantilar.some((b) => BaglantilarService.taranir(b.saglayici)),
  );
}

/** Planlayıcının iş açarken baktığı en uzun irsaliye yanıt süresi; kiracının kendi süresi işte uygulanır. */
const EIRSALIYE_AZAMI_YANIT_GUNU = 60;

@Injectable()
export class EbelgeKuyrukService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EbelgeKuyrukService.name);
  private readonly kuyruk = new Queue<EbelgeKuyrukVerisi>(KUYRUK_ADI, {
    connection: redisBaglantisi(),
    defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: { age: 604_800, count: 10_000 }, removeOnFail: false },
  });
  private readonly kuyrukOlaylari = new QueueEvents(KUYRUK_ADI, { connection: redisBaglantisi() });
  private readonly deadLetter = new Queue<DeadLetterVerisi>(DEAD_LETTER_KUYRUGU, { connection: redisBaglantisi(), defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });
  private worker?: Worker<EbelgeKuyrukVerisi>;
  private periyodikKontrol?: NodeJS.Timeout;
  private zamanlamaCalisiyor = false;

  constructor(
    @Inject(forwardRef(() => EbelgeService)) private readonly ebelgeService: EbelgeService,
    private readonly metrics: MetricsService,
    private readonly eirsaliyeService?: EirsaliyeService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  async onModuleInit() {
    this.kuyruk.on("error", (hata) => this.logger.error(`e-Belge kuyruğu Redis hatası: ${hata.message}`));
    this.kuyrukOlaylari.on("completed", () => this.metrics.increment("ebelge_queue_jobs_total", { result: "completed" }));
    this.kuyrukOlaylari.on("failed", () => this.metrics.increment("ebelge_queue_jobs_total", { result: "failed" }));
    this.kuyrukOlaylari.on("error", (hata) => this.logger.error(`e-Belge kuyruk olayları hatası: ${hata.message}`));
    await this.kuyrukOlaylari.waitUntilReady();
    if (process.env.TEKIR_WORKER !== "1") return;
    this.worker = new Worker<EbelgeKuyrukVerisi>(KUYRUK_ADI, (is, token) => this.isle(is, token), {
      connection: redisBaglantisi(), concurrency: Number(process.env.EBELGE_WORKER_CONCURRENCY || 4), lockDuration: 120_000,
    });
    this.worker.on("completed", (is) => this.logger.log(JSON.stringify({ event: "ebelge_job_completed", jobId: is.id, tenantId: is.data.tenantId, faturaId: is.data.faturaId })));
    this.worker.on("failed", (is, hata) => this.logger.error(JSON.stringify({ event: "ebelge_job_failed", jobId: is?.id, tenantId: is?.data.tenantId, faturaId: is?.data.faturaId, attempt: is?.attemptsMade, error: hata.message })));
    this.worker.on("failed", (is, hata) => { if (is && (is.attemptsMade >= (is.opts.attempts || 1) || hata instanceof UnrecoverableError)) void this.deadLetteraTasi(is, hata); });
    this.worker.on("error", (hata) => this.logger.error(`e-Belge worker hatası: ${hata.message}`));
    await this.worker.waitUntilReady();
    this.logger.log(`e-Belge worker hazır; concurrency=${this.worker.opts.concurrency}`);
    setImmediate(() => void nabizla("ebelge-kuyruk", () => this.periyodikIsleriPlanla()));
    const aralik = Number(process.env.EBELGE_SCHEDULE_INTERVAL_MS || 300_000);
    this.periyodikKontrol = setInterval(() => void nabizla("ebelge-kuyruk", () => this.periyodikIsleriPlanla(), aralik), aralik);
  }

  async onModuleDestroy() { if (this.periyodikKontrol) clearInterval(this.periyodikKontrol); await this.worker?.close(); await this.kuyrukOlaylari.close(); await this.deadLetter.close(); await this.kuyruk.close(); }

  async kuyrugaEkle(faturaId: string) {
    const baglam = aktifBaglam(); const jobId = isKimligi(baglam.tenantId, faturaId);
    const mevcut = await this.kuyruk.getJob(jobId);
    if (mevcut) {
      const durum = await mevcut.getState();
      // Biten iş kuyrukta kimliğiyle duruyor; kaldırılmazsa aynı fatura için
      // ikinci gönderim sessizce yutulur ve kullanıcı "gönderildi" der ama
      // hiçbir şey olmaz (e-Arşiv denemesi, 2026-09-10). Süren işte ise tekrar
      // eklemek mükerrer gönderim olurdu, olduğu gibi bildirilir.
      if (durum !== "completed" && durum !== "failed") return { isId: mevcut.id, durum, tekrar: true };
      await mevcut.remove();
    }
    // Yalnız kullanıcı gönderir; eski dead-letter kaydı kalırsa worker yeni işi
    // "dead-letter var" diye atlar ve fatura dünkü hatasıyla kalır (EBLG-38'in
    // gönderimdeki eşi, 2026-09-19). Açık gönderim onu temizler.
    const eskiDeadLetter = await this.deadLetter.getJob(`dead-${jobId}`);
    if (eskiDeadLetter) {
      await eskiDeadLetter.remove();
      this.metrics.increment("ebelge_queue_jobs_total", { result: "dead_letter_retry", type: GONDERIM_ISI });
    }
    try {
      const is = await this.kuyruk.add(GONDERIM_ISI, { tenantId: baglam.tenantId, userId: baglam.userId, rol: baglam.rol, isTuru: GONDERIM_ISI, faturaId, correlationId: crypto.randomUUID(), kuyrugaAlinmaZamani: new Date().toISOString() }, { jobId });
      this.metrics.increment("ebelge_queue_jobs_total", { result: "enqueued" });
      return { isId: is.id, durum: "waiting", tekrar: false };
    } catch (hata) {
      this.logger.error(`e-Belge işi kuyruğa alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      throw new ServiceUnavailableException("e-Belge kuyruğuna şu anda erişilemiyor; lütfen tekrar deneyin");
    }
  }

  async durumSorgulaKuyrugaEkle(faturaId: string) {
    const baglam = aktifBaglam();
    const jobId = durumIsKimligi(baglam.tenantId, faturaId);
    // EBLG-38: fatura başına durum işini yalnız kullanıcı açar (planlayıcı toplu
    // iş kullanır). Eski dead-letter kaydı kalırsa bu faturanın her sorgusu
    // sessizce yutulurdu; açık kullanıcı eylemi onu temizler.
    const eskiDeadLetter = await this.deadLetter.getJob(`dead-${jobId}`);
    if (eskiDeadLetter) {
      await eskiDeadLetter.remove();
      this.metrics.increment("ebelge_queue_jobs_total", { result: "dead_letter_retry", type: DURUM_ISI });
    }
    return this.tekrarlanabilirIsEkle(DURUM_ISI, jobId, { faturaId });
  }

  /** `elle`: kullanıcı "Tazele" dedi; eski dead-letter kaydı beklenmeden temizlenir (EBLG-98). */
  async gelenBelgeleriKuyrugaEkle(elle = false) {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(GELEN_ISI, gelenIsKimligi(baglam.tenantId), {}, { elle });
  }

  async durumlariTopluKuyrugaEkle() {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(DURUM_TOPLU_ISI, durumTopluIsKimligi(baglam.tenantId));
  }

  /** EBLG-36: kiracının bekleyen giden e-İrsaliyeleri için tek toplu durum işi. */
  async irsaliyeDurumlariKuyrugaEkle() {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(EIRSALIYE_DURUM_TOPLU_ISI, eirsaliyeDurumTopluIsKimligi(baglam.tenantId));
  }

  /** EBLG-109: kiracının gelen e-İrsaliye taraması. */
  async gelenIrsaliyeleriKuyrugaEkle() {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(EIRSALIYE_GELEN_ISI, eirsaliyeGelenIsKimligi(baglam.tenantId));
  }

  async mukellefSenkronKuyrugaEkle() {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(MUKELLEF_SENKRON_ISI, mukellefSenkronIsKimligi());
  }

  async earsivRaporKuyrugaEkle(raporUuid: string) {
    const baglam = aktifBaglam();
    return this.tekrarlanabilirIsEkle(EARSIV_RAPOR_ISI, earsivRaporIsKimligi(baglam.tenantId, raporUuid), { raporUuid });
  }

  async ozet() {
    const { tenantId } = aktifBaglam();
    const isler = await this.tenantIsleriniGetir(["waiting", "active", "delayed", "failed", "completed"], tenantId);
    const deadLetterIsleri = await this.tenantDeadLetterIsleriniGetir(tenantId);
    const deadLetterAsilIdleri = new Set(deadLetterIsleri.map((is) => is.data.asilIsId));
    const sayilar: Record<string, number> = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    await Promise.all(isler.map(async (is) => { if (deadLetterAsilIdleri.has(String(is.id))) return; const durum = await is.getState(); sayilar[durum] = (sayilar[durum] || 0) + 1; }));
    sayilar["dead-letter"] = deadLetterIsleri.length;
    return { sayilar, calisanWorker: await this.calisanWorkerSayisi() };
  }

  /**
   * Kuyruğu dinleyen worker sayısı (EBLG-48).
   *
   * Gönderim isteği kuyruğa yazılır ve hemen döner; worker süreci ayakta
   * değilse iş "waiting"te öylece durur ve ekranda hiçbir belirti olmaz —
   * bir NES test gönderiminde saatler bu yüzden kaybedildi. Sayı bilinmiyorsa
   * (Redis cevap vermedi) null döner ki ekran "worker yok" diye yanlış alarm
   * vermesin.
   */
  private async calisanWorkerSayisi(): Promise<number | null> {
    try {
      return await this.kuyruk.getWorkersCount();
    } catch (hata) {
      this.logger.warn(`Worker sayısı okunamadı: ${hata instanceof Error ? hata.message : hata}`);
      return null;
    }
  }

  async listele() {
    const { tenantId } = aktifBaglam();
    const deadLetterIsleri = await this.tenantDeadLetterIsleriniGetir(tenantId, 200, false);
    const deadLetterAsilIdleri = new Set(deadLetterIsleri.map((is) => is.data.asilIsId));
    const isler = (await this.tenantIsleriniGetir(["waiting", "active", "delayed", "failed", "completed"], tenantId, 200, false)).filter((is) => !deadLetterAsilIdleri.has(String(is.id)));
    const normal = await Promise.all(isler.map(async (is) => ({ id: is.id, isTuru: is.data.isTuru || is.name, faturaId: is.data.faturaId || null, durum: await is.getState(), deneme: is.attemptsMade, azamiDeneme: is.opts.attempts || 1, hata: is.failedReason || null, kuyrugaAlinmaZamani: is.data.kuyrugaAlinmaZamani, islenmeZamani: is.processedOn ? new Date(is.processedOn).toISOString() : null, tamamlanmaZamani: is.finishedOn ? new Date(is.finishedOn).toISOString() : null })));
    const dlq = deadLetterIsleri.map((is) => ({ id: String(is.id), isTuru: is.data.isTuru, faturaId: is.data.faturaId || null, durum: "dead-letter", deneme: 5, azamiDeneme: 5, hata: is.data.hata, kuyrugaAlinmaZamani: is.data.kuyrugaAlinmaZamani, islenmeZamani: null, tamamlanmaZamani: is.data.deadLetterZamani }));
    return [...dlq, ...normal];
  }

  private async tenantIsleriniGetir(
    durumlar: Parameters<Queue<EbelgeKuyrukVerisi>["getJobs"]>[0],
    tenantId: string,
    sinir = Number.POSITIVE_INFINITY,
    artan = true,
  ) {
    const sonuc: Job<EbelgeKuyrukVerisi>[] = [];
    const sayfaBoyutu = 500;
    for (let baslangic = 0; sonuc.length < sinir; baslangic += sayfaBoyutu) {
      const sayfa = await this.kuyruk.getJobs(durumlar, baslangic, baslangic + sayfaBoyutu - 1, artan);
      sonuc.push(...sayfa.filter((is) => is.data.tenantId === tenantId));
      if (sayfa.length < sayfaBoyutu) break;
    }
    return sonuc.slice(0, sinir);
  }

  private async tenantDeadLetterIsleriniGetir(tenantId: string, sinir = Number.POSITIVE_INFINITY, artan = true) {
    const sonuc: Job<DeadLetterVerisi>[] = [];
    const sayfaBoyutu = 500;
    for (let baslangic = 0; sonuc.length < sinir; baslangic += sayfaBoyutu) {
      const sayfa = await this.deadLetter.getJobs(["waiting"], baslangic, baslangic + sayfaBoyutu - 1, artan);
      sonuc.push(...sayfa.filter((is) => is.data.tenantId === tenantId));
      if (sayfa.length < sayfaBoyutu) break;
    }
    return sonuc.slice(0, sinir);
  }

  /**
   * PLT-17: tüm firmaların kuyruk sayıları ve kuyruktan düşmüş işler (iş türü,
   * hata, zaman; belge içeriği yok). Yalnız platform ekranı ve alarm okur.
   */
  async platformOzeti() {
    const [sayilar, olu] = await Promise.all([
      this.kuyruk.getJobCounts("waiting", "active", "delayed", "failed"),
      this.deadLetter.getJobs(["waiting"], 0, 499, false),
    ]);
    const firmaSayilari = new Map<string, Partial<Record<"waiting" | "active" | "delayed" | "failed", number>>>();
    for (const durum of ["waiting", "active", "delayed", "failed"] as const) {
      for (const is of await this.kuyruk.getJobs([durum], 0, 999, false)) {
        const k = firmaSayilari.get(is.data.tenantId) ?? {};
        k[durum] = (k[durum] ?? 0) + 1;
        firmaSayilari.set(is.data.tenantId, k);
      }
    }
    return {
      sayilar: { ...sayilar, deadLetter: olu.length },
      firmalar: [...firmaSayilari].map(([tenantId, s]) => ({ tenantId, ...s })),
      oluIsler: olu.map((is) => ({ id: String(is.id), tenantId: is.data.tenantId, isTuru: is.data.isTuru || is.name, hata: String(is.data.hata ?? "").slice(0, 500), zaman: is.data.deadLetterZamani })),
    };
  }

  /** PLT-18: platform kuyruktan düşen işi firmanın bağlamında yeniden kuyruğa alır. */
  async platformYenidenDene(oluIsId: string) {
    const olu = await this.deadLetter.getJob(oluIsId);
    if (!olu) throw new NotFoundException("Kuyruktan düşen iş bulunamadı");
    return baglamlaCalistir({ tenantId: olu.data.tenantId, userId: olu.data.userId || SISTEM_KULLANICISI, rol: olu.data.rol || "muhasebe" }, () => this.yenidenDene(oluIsId));
  }

  async yenidenDene(isId: string) {
    const baglam = aktifBaglam(); const is = await this.kuyruk.getJob(isId);
    if (!is) {
      const dlq = await this.deadLetter.getJob(isId);
      if (!dlq || dlq.data.tenantId !== baglam.tenantId) throw new NotFoundException("Kuyruk işi bulunamadı");
      const asilIs = await this.kuyruk.getJob(dlq.data.asilIsId);
      if (asilIs) await asilIs.remove();
      await dlq.remove();
      this.metrics.increment("ebelge_queue_jobs_total", { result: "dead_letter_retry", type: dlq.data.isTuru });
      if (dlq.data.isTuru === GELEN_ISI) return this.gelenBelgeleriKuyrugaEkle();
      if (dlq.data.isTuru === DURUM_TOPLU_ISI) return this.durumlariTopluKuyrugaEkle();
      if (dlq.data.isTuru === EIRSALIYE_DURUM_TOPLU_ISI) return this.irsaliyeDurumlariKuyrugaEkle();
      if (dlq.data.isTuru === EIRSALIYE_GELEN_ISI) return this.gelenIrsaliyeleriKuyrugaEkle();
      if (dlq.data.isTuru === MUKELLEF_SENKRON_ISI) return this.mukellefSenkronKuyrugaEkle();
      if (dlq.data.isTuru === EARSIV_RAPOR_ISI) {
        if (!dlq.data.raporUuid) throw new NotFoundException("Dead-letter işi rapor bilgisi eksik");
        return this.earsivRaporKuyrugaEkle(dlq.data.raporUuid);
      }
      if (!dlq.data.faturaId) throw new NotFoundException("Dead-letter işi varlık bilgisi eksik");
      return dlq.data.isTuru === DURUM_ISI ? this.durumSorgulaKuyrugaEkle(dlq.data.faturaId) : this.kuyrugaEkle(dlq.data.faturaId);
    }
    if (is.data.tenantId !== baglam.tenantId) throw new NotFoundException("Kuyruk işi bulunamadı");
    const durum = await is.getState();
    if (durum !== "failed") return { isId: is.id, durum, tekrar: true };
    const veri = is.data; await is.remove(); this.metrics.increment("ebelge_queue_jobs_total", { result: "manual_retry", type: veri.isTuru || is.name });
    if ((veri.isTuru || is.name) === GELEN_ISI) return this.gelenBelgeleriKuyrugaEkle();
    if ((veri.isTuru || is.name) === DURUM_TOPLU_ISI) return this.durumlariTopluKuyrugaEkle();
    if ((veri.isTuru || is.name) === EIRSALIYE_DURUM_TOPLU_ISI) return this.irsaliyeDurumlariKuyrugaEkle();
    if ((veri.isTuru || is.name) === EIRSALIYE_GELEN_ISI) return this.gelenIrsaliyeleriKuyrugaEkle();
    if ((veri.isTuru || is.name) === MUKELLEF_SENKRON_ISI) return this.mukellefSenkronKuyrugaEkle();
    if ((veri.isTuru || is.name) === EARSIV_RAPOR_ISI) {
      if (!veri.raporUuid) throw new NotFoundException("Kuyruk işi rapor bilgisi eksik");
      return this.earsivRaporKuyrugaEkle(veri.raporUuid);
    }
    if (!veri.faturaId) throw new NotFoundException("Kuyruk işi varlık bilgisi eksik");
    return (veri.isTuru || is.name) === DURUM_ISI ? this.durumSorgulaKuyrugaEkle(veri.faturaId) : this.kuyrugaEkle(veri.faturaId);
  }

  private async isle(is: Job<EbelgeKuyrukVerisi>, token?: string) {
    if (await this.deadLetter.getJob(`dead-${is.id}`)) {
      this.logger.warn(JSON.stringify({ event: "ebelge_job_skipped_dead_letter_exists", jobId: is.id, tenantId: is.data.tenantId }));
      return { atlandi: true, neden: "dead-letter kaydı mevcut" };
    }
    // PLT-05: askıdaki firmada periyodik tarama atlanır (askı kalkınca sonraki
    // turda yeniden açılır); belge işi kaybolmasın diye ertelenir. Mükellef
    // listesi kiracıdan bağımsızdır, durmaz.
    if ((is.name !== MUKELLEF_SENKRON_ISI && (await this.erisim?.otomasyonDurdu(is.data.tenantId, "ebelge"))) || (is.name === MUKELLEF_SENKRON_ISI && await this.erisim?.modulKapali(is.data.tenantId, "ebelge"))) {
      if (PERIYODIK_ISLER.has(is.name)) {
        this.logger.warn(JSON.stringify({ event: "ebelge_kiraci_isi_atlandi", jobId: is.id, tenantId: is.data.tenantId, type: is.name, neden: "firma askıda" }));
        return { atlandi: true, neden: "firma askıda" };
      }
      await is.moveToDelayed(Date.now() + askiErtelemeMs(), token);
      this.logger.warn(JSON.stringify({ event: "ebelge_job_delayed_suspended", jobId: is.id, tenantId: is.data.tenantId, type: is.name }));
      throw new DelayedError();
    }
    return baglamlaCalistir({ tenantId: is.data.tenantId, userId: is.data.userId, rol: is.data.rol }, async () => {
      // EBLG-98: kiracı işinde bizim tarafın reddi (ör. bağlantı bu arada
      // pasife çekildi) yeniden denemeyle düzelmez; iş atlanır, sonraki tur
      // bağlantı aktifse yine açılır. Dead-letter'a düşürmek işi durdururdu.
      if (is.name === GELEN_ISI || is.name === DURUM_TOPLU_ISI || is.name === MUKELLEF_SENKRON_ISI) {
        try {
          if (is.name === GELEN_ISI) return await this.ebelgeService.gelenBelgeleriCek();
          if (is.name === DURUM_TOPLU_ISI) return await this.ebelgeService.durumlariTopluSorgula();
          return await this.ebelgeService.mukellefListesiSenkronEt();
        } catch (hata) {
          if (!(hata instanceof BadRequestException || hata instanceof NotFoundException)) throw hata;
          this.logger.warn(JSON.stringify({ event: "ebelge_kiraci_isi_atlandi", jobId: is.id, tenantId: is.data.tenantId, type: is.name, neden: hata.message }));
          return { atlandi: true, neden: hata.message };
        }
      }
      if (is.name === EIRSALIYE_GELEN_ISI) {
        if (!this.eirsaliyeService) throw new Error("e-İrsaliye servisi worker'a bağlanmamış");
        try {
          return await this.eirsaliyeService.gelenleriCek();
        } catch (hata) {
          // GELEN_ISI ile aynı kural: bizim taraftaki ret (bağlantı pasif vb.) yeniden denemeyle düzelmez.
          if (!(hata instanceof BadRequestException || hata instanceof NotFoundException)) throw hata;
          this.logger.warn(JSON.stringify({ event: "ebelge_kiraci_isi_atlandi", jobId: is.id, tenantId: is.data.tenantId, type: is.name, neden: hata.message }));
          return { atlandi: true, neden: hata.message };
        }
      }
      if (is.name === EIRSALIYE_DURUM_TOPLU_ISI) {
        if (!this.eirsaliyeService) throw new Error("e-İrsaliye servisi worker'a bağlanmamış");
        const durum = await this.eirsaliyeService.durumlariTopluSorgula();
        // EBLG-94: geçici hatayla düşen gönderimler aynı işte, aynı numarayla yeniden denenir.
        return { ...durum, yenidenDeneme: await this.eirsaliyeService.geciciHatalariYenidenGonder() };
      }
      if (is.name === EARSIV_RAPOR_ISI) {
        if (!is.data.raporUuid) throw new Error("Kuyruk işinde e-Arşiv rapor UUID bilgisi eksik");
        const sonuc = await this.ebelgeService.earsivRaporDurum(is.data.raporUuid);
        if (!sonuc.basarili) throw new Error(sonuc.mesaj || "e-Arşiv rapor durumu sorgulanamadı");
        return sonuc;
      }
      if (!is.data.faturaId) throw new Error("Kuyruk işinde fatura kimliği eksik");
      if (is.name === DURUM_ISI) {
        try {
          return await this.ebelgeService.durumSorgula(is.data.faturaId);
        } catch (hata) {
          // Kayıt yok ya da belge gönderilmemiş: yeniden denemek aynı sonuca
          // varır ve iş dead-letter'a düşerdi (EBLG-38). İş atlanmış olarak biter.
          if (!(hata instanceof BadRequestException || hata instanceof NotFoundException)) throw hata;
          this.logger.warn(JSON.stringify({ event: "ebelge_durum_sorgusu_atlandi", jobId: is.id, tenantId: is.data.tenantId, faturaId: is.data.faturaId, neden: hata.message }));
          return { atlandi: true, neden: hata.message };
        }
      }
      if (is.name === GONDERIM_ISI) {
        // Kalıcı hata yeniden denenmez: entegratörün belgeye itirazı ya da
        // bizim doğrulamamız aynı belgede aynı sonucu verir. Denemeye devam
        // etmek boşa çağrıdır ve arada ayar değişirse ilk (asıl) sebebi başka
        // bir mesajla ezer — kullanıcı neden reddedildiğini göremez.
        let sonuc: Awaited<ReturnType<EbelgeService["gonder"]>>;
        try {
          sonuc = await this.ebelgeService.gonder(is.data.faturaId);
        } catch (hata) {
          if (hata instanceof BadRequestException || hata instanceof NotFoundException) throw new UnrecoverableError(hata.message);
          throw hata;
        }
        if (!sonuc.basarili) {
          const mesaj = sonuc.hataMesaji || "Entegratör gönderimi başarısız";
          throw sonuc.kalici ? new UnrecoverableError(mesaj) : new Error(mesaj);
        }
        return sonuc;
      }
      throw new Error(`Desteklenmeyen e-Belge işi: ${is.name}`);
    });
  }

  private async tekrarlanabilirIsEkle(isTuru: EbelgeIsTuru, jobId: string, ek: { faturaId?: string; raporUuid?: string } = {}, secenek: { elle?: boolean } = {}) {
    const baglam = aktifBaglam();
    const deadLetterIsi = await this.deadLetter.getJob(`dead-${jobId}`);
    if (deadLetterIsi) {
      // Dead-letter aynı hatayı entegratöre tekrar tekrar sormamak için var;
      // periyodik işte ise süresiz beklemek işi kalıcı olarak durdurur (EBLG-98).
      const dustugu = Date.parse(deadLetterIsi.data?.deadLetterZamani ?? "") || deadLetterIsi.timestamp || 0;
      const temizle = PERIYODIK_ISLER.has(isTuru) && (secenek.elle || Date.now() - dustugu >= deadLetterBeklemeMs());
      if (!temizle) return { isId: deadLetterIsi.id, durum: "dead-letter", tekrar: true };
      await deadLetterIsi.remove();
      this.metrics.increment("ebelge_queue_jobs_total", { result: "dead_letter_retry", type: isTuru });
    }
    const mevcut = await this.kuyruk.getJob(jobId);
    if (mevcut) {
      const durum = await mevcut.getState();
      if (["waiting", "active", "delayed"].includes(durum)) return { isId: mevcut.id, durum, tekrar: true };
      await mevcut.remove();
    }
    try {
      const is = await this.kuyruk.add(isTuru, { tenantId: baglam.tenantId, userId: baglam.userId, rol: baglam.rol, isTuru, ...ek, correlationId: crypto.randomUUID(), kuyrugaAlinmaZamani: new Date().toISOString() }, { jobId });
      this.metrics.increment("ebelge_queue_jobs_total", { result: "enqueued", type: isTuru });
      return { isId: is.id, durum: "waiting", tekrar: false };
    } catch (hata) {
      this.logger.error(`${isTuru} işi kuyruğa alınamadı: ${hata instanceof Error ? hata.message : String(hata)}`);
      throw new ServiceUnavailableException("e-Belge kuyruğuna şu anda erişilemiyor; lütfen tekrar deneyin");
    }
  }

  private async deadLetteraTasi(is: Job<EbelgeKuyrukVerisi>, hata: Error) {
    const jobId = `dead-${is.id}`;
    if (await this.deadLetter.getJob(jobId)) return;
    await this.deadLetter.add(is.name, { ...is.data, isTuru: is.data.isTuru || is.name as EbelgeIsTuru, asilIsId: String(is.id), hata: hata.message, deadLetterZamani: new Date().toISOString() }, { jobId });
    this.metrics.increment("ebelge_queue_dead_letter_total", { type: is.name });
    this.logger.error(JSON.stringify({ event: "ebelge_dead_letter", jobId: is.id, tenantId: is.data.tenantId, type: is.name, error: hata.message }));
  }

  private async periyodikIsleriPlanla() {
    if (this.zamanlamaCalisiyor) return;
    this.zamanlamaCalisiyor = true;
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) { this.logger.warn("Periyodik e-Belge işleri için DATABASE_URL_MIGRATE tanımlı değil"); this.zamanlamaCalisiyor = false; return; }
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try {
      const tenantlar = await yonetim.tenant.findMany({
        where: { baglantilar: { some: { aile: "ebelge", durum: "aktif" } } },
        // EBLG-77: kapalı uygulamanın periyodik işi hiç açılmaz.
        select: {
          id: true, vkn: true, efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: true,
          baglantilar: { where: { aile: "ebelge", durum: "aktif" }, select: { saglayici: true } },
        },
      });
      const uygulamalar = new Map<string, EbelgeUygulamalari>();
      for (const tenant of tenantlar) {
        uygulamalar.set(tenant.id, await ebelgeUygulamalariCozTenant(yonetim, tenant));
      }

      // Mükellef listesi kiracıdan bağımsız ve global; tur başına en fazla bir
      // kez, o da günlük aralık dolduysa kuyruğa girer (EBLG-10). Liste yalnız
      // e-Fatura kanalında anlamlıdır: hiçbir kiracı e-Fatura kullanmıyorsa
      // indirilmez. Durumu bilinmeyen kiracı için indirilir — bilinmezliği
      // zaten listenin kendisi çözecek.
      const listeKullanan = listeSenkronKiracisi(tenantlar, uygulamalar);
      if (listeKullanan && (await this.ebelgeService.mukellefSenkronVaktiGeldi())) {
        await baglamlaCalistir({ tenantId: listeKullanan.id, userId: SISTEM_KULLANICISI, rol: "muhasebe" }, () => this.mukellefSenkronKuyrugaEkle());
      }

      for (const tenant of tenantlar) {
        // PLT-05: askıdaki firmada gelen tarama ve durum sorguları açılmaz.
        if (await this.erisim?.otomasyonDurdu(tenant.id, "ebelge")) continue;
        const tenantUygulamalari = uygulamalar.get(tenant.id);
        await baglamlaCalistir({ tenantId: tenant.id, userId: SISTEM_KULLANICISI, rol: "muhasebe" }, async () => {
          // Gelen belge taraması kursörle ilerler; aralık dolmadan yeni iş
          // açmak aynı tarih penceresini tekrar sorgulamak olurdu (EBLG-11).
          // Gelen kutusu yalnız e-Fatura mükellefinde vardır (EBLG-77).
          const kursor = await yonetim.ebelgeGelenKursor.findUnique({ where: { tenantId: tenant.id }, select: { sonCekimAt: true, irsaliyeSonCekimAt: true } });
          if (tenantUygulamalari && uygulamaAcik(tenantUygulamalari, "efatura") && (!kursor || Date.now() - kursor.sonCekimAt.getTime() >= gelenTaramaAralikMs())) {
            await this.gelenBelgeleriKuyrugaEkle();
          }

          // Zarf durumları fatura başına değil, kiracı başına tek toplu iş
          // olarak sorgulanır; sorgulanacak kayıt yoksa iş hiç açılmaz (EBLG-14).
          // Süreli koşul en uzun sürelerle bakılır, kiracının süresi işte
          // uygulanır (EBLG-40).
          const bekleyen = await yonetim.ebelgeKayit.count({
            where: faturaSorguKosulu(tenant.id, Date.now(), AZAMI_FATURA_SORGU_SURELERI),
          });
          if (bekleyen > 0) await this.durumlariTopluKuyrugaEkle();

          // EBLG-36: giden e-İrsaliye durumları da kiracı başına tek işte
          // sorgulanır. Kiracının yanıt süresi ayarı işte uygulanır; burada en
          // uzun süreyle yalnız iş açılıp açılmayacağına bakılır.
          const bekleyenIrsaliye = tenantUygulamalari && uygulamaAcik(tenantUygulamalari, "eirsaliye")
            ? await yonetim.eirsaliyeKayit.count({
                where: { OR: [eirsaliyeSorguKosulu(tenant.id, Date.now(), EIRSALIYE_AZAMI_YANIT_GUNU), eirsaliyeYenidenDenemeKosulu(tenant.id, Date.now())] },
              })
            : 0;
          if (bekleyenIrsaliye > 0) await this.irsaliyeDurumlariKuyrugaEkle();

          // EBLG-109: gelen e-İrsaliye de e-Faturadaki aralıkla taranır; müşteriden
          // gelen irsaliye eskiden biri "Gelenleri kontrol et"e basana kadar görünmezdi.
          if (tenantUygulamalari && uygulamaAcik(tenantUygulamalari, "eirsaliye") && (!kursor?.irsaliyeSonCekimAt || Date.now() - kursor.irsaliyeSonCekimAt.getTime() >= gelenTaramaAralikMs())) {
            await this.gelenIrsaliyeleriKuyrugaEkle();
          }
        });
      }
      this.metrics.increment("ebelge_schedule_runs_total", { result: "success" });
      await this.kuyrukMetrikleriniGuncelle();
    } catch (hata) {
      this.metrics.increment("ebelge_schedule_runs_total", { result: "failed" });
      this.logger.error("Periyodik e-Belge planlama başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally { await yonetim.$disconnect(); this.zamanlamaCalisiyor = false; }
  }

  private async kuyrukMetrikleriniGuncelle() {
    const sayilar = await this.kuyruk.getJobCounts("waiting", "active", "delayed", "failed");
    for (const [durum, adet] of Object.entries(sayilar)) this.metrics.set("ebelge_queue_depth", adet, { state: durum });
    const enEski = (await this.kuyruk.getJobs(["waiting", "delayed"], 0, 0, true))[0];
    this.metrics.set("ebelge_queue_oldest_job_age_seconds", enEski ? Math.max(0, (Date.now() - enEski.timestamp) / 1000) : 0);
    const deadLetterSayisi = await this.deadLetter.getJobCountByTypes("waiting");
    this.metrics.set("ebelge_queue_dead_letter_depth", deadLetterSayisi);
  }
}
