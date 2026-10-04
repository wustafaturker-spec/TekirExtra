import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import type { Rol } from "@tekirextra/shared";
import { baglamlaCalistir } from "../core/istek-baglami";
import { redisBaglantisi } from "../core/redis-baglantisi";
import { bordroTahakkukSemasi } from "./personel.semalar";
import { PersonelService } from "./personel.service";

const KUYRUK_ADI = "tekirextra-personel";
const TAHAKKUK_ISI = "bordro-tahakkuk";

interface TahakkukIsVerisi { tenantId: string; userId: string; rol: Rol; donemYil: number; donemAy: number }

/** Bu sayıdan büyük kadroda tahakkuk arka plana alınır (çalışan worker varsa). */
const arkaPlanEsigi = () => Number(process.env.PERSONEL_TAHAKKUK_ARKA_PLAN_ESIGI || 100);

/**
 * PRS-20 (P3-5): büyük kadroda toplu bordro tahakkuku worker sürecinde
 * çalışır; ekran ilerlemeyi iş kimliğiyle izler. Küçük kadroda ya da worker
 * veya Redis yoksa tahakkuk istek içinde hemen yapılır (eski davranış).
 * Aynı kiracı ve dönem için tek iş: süren iş varsa onun kimliği döner.
 */
@Injectable()
export class PersonelKuyrukService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersonelKuyrukService.name);
  private kuyruk?: Queue<TahakkukIsVerisi>;
  private worker?: Worker<TahakkukIsVerisi>;

  constructor(private readonly personel: PersonelService) {}

  private kuyrukAl() {
    this.kuyruk ??= new Queue<TahakkukIsVerisi>(KUYRUK_ADI, { connection: redisBaglantisi(), defaultJobOptions: { attempts: 1, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 86_400 } } });
    return this.kuyruk;
  }

  async onModuleInit() {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.worker = new Worker<TahakkukIsVerisi>(KUYRUK_ADI, (is) => this.isle(is), { connection: redisBaglantisi(), concurrency: 1, lockDuration: 300_000 });
    this.worker.on("failed", (is, hata) => this.logger.error(JSON.stringify({ event: "personel_job_failed", jobId: is?.id, tenantId: is?.data.tenantId, error: hata.message })));
    this.worker.on("error", (hata) => this.logger.error(`Personel worker hatası: ${hata.message}`));
    await this.worker.waitUntilReady();
    this.logger.log("Personel worker hazır");
  }

  async onModuleDestroy() { await this.worker?.close(); await this.kuyruk?.close(); }

  private isle(is: Job<TahakkukIsVerisi>) {
    const { tenantId, userId, rol, donemYil, donemAy } = is.data;
    return baglamlaCalistir({ tenantId, userId, rol }, () =>
      this.personel.bordroTopluTahakkuk(tenantId, userId, { donemYil, donemAy }, (yapilan, toplam) => is.updateProgress({ yapilan, toplam })));
  }

  async tahakkukBaslat(tenantId: string, userId: string, rol: Rol, girdi: unknown) {
    const { donemYil, donemAy } = bordroTahakkukSemasi.parse(girdi);
    const kadro = await this.personel.tahakkukKapsamSayisi(tenantId, donemYil, donemAy);
    if (kadro > arkaPlanEsigi()) {
      try {
        const kuyruk = this.kuyrukAl();
        if ((await kuyruk.getWorkers()).length) {
          const jobId = `bordro-tahakkuk-${tenantId}-${donemYil}-${donemAy}`;
          const mevcut = await kuyruk.getJob(jobId);
          if (mevcut) {
            const durum = await mevcut.getState();
            if (durum !== "completed" && durum !== "failed") return { arkaPlan: true, isId: jobId, toplamAktifPersonel: kadro };
            await mevcut.remove();
          }
          await kuyruk.add(TAHAKKUK_ISI, { tenantId, userId, rol, donemYil, donemAy }, { jobId });
          return { arkaPlan: true, isId: jobId, toplamAktifPersonel: kadro };
        }
        this.logger.warn(`Personel worker çalışmıyor; ${kadro} kişilik tahakkuk istek içinde yapılıyor`);
      } catch (hata) {
        this.logger.warn(`Personel kuyruğuna ulaşılamadı (${hata instanceof Error ? hata.message : hata}); tahakkuk istek içinde yapılıyor`);
      }
    }
    return { arkaPlan: false, ...(await this.personel.bordroTopluTahakkuk(tenantId, userId, { donemYil, donemAy })) };
  }

  async isDurumu(tenantId: string, isId: string) {
    const is = await this.kuyrukAl().getJob(isId);
    if (!is || is.data.tenantId !== tenantId) throw new NotFoundException("Tahakkuk işi bulunamadı (tamamlanan işler 1 gün saklanır)");
    const durum = await is.getState();
    return { isId, durum, donemYil: is.data.donemYil, donemAy: is.data.donemAy, ilerleme: typeof is.progress === "object" ? is.progress : null, sonuc: durum === "completed" ? is.returnvalue : null, hata: durum === "failed" ? is.failedReason : null };
  }
}
