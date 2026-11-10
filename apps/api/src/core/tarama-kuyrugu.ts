import { Logger } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { nabizAtlandi, nabizla } from "./nabiz/nabiz";
import { redisBaglantisi } from "./redis-baglantisi";

/**
 * BLD-17: firma başına tarama kuyruğu. Her tarama türü (bildirim, düzeltme)
 * kendi kuyruğunu kullanır:
 *
 * - Planlayıcı BullMQ iş zamanlayıcısıyla (`upsertJobScheduler`) çalışır; kaç
 *   worker olursa olsun her aralıkta tek planlayıcı işi düşer.
 * - Firma işi kimliği firma kimliğidir: aynı firma için kuyrukta ya da
 *   çalışırken ikinci iş açılmaz (eklenmek istenen yok sayılır). Böylece
 *   birden çok worker aynı firmayı aynı anda taramaz.
 * - İşler tamamlanınca/hata verince silinir ki sonraki tur aynı kimliği
 *   yeniden ekleyebilsin; hata işleyicide loglanır, kuyrukta yeniden denenmez
 *   (sonraki tur zaten tarar).
 * - Planlayıcı çalıştığında önceki turdan iş kaldıysa tur "atlandı" sayılır
 *   (BLD-12 alarmı).
 */
export interface TaramaKuyruguAyari<T extends { tenantId: string }> {
  /** Kuyruk ve nabız adı eki: "bildirim" | "duzeltme". */
  tur: string;
  /** Sistem Sağlığı'ndaki iş adı (eski zamanlayıcı adı korunur). */
  nabizAdi: string;
  aralikMs: number;
  /** Bu tur taranacak firma işleri. */
  planla: () => Promise<T[]>;
  /** Tek firma işi. */
  isle: (veri: T) => Promise<void>;
  /** İş kimliği (varsayılan firma kimliği). Aynı kimlikle kuyrukta ikinci iş açılmaz; ':' kullanılmaz (BullMQ). */
  isKimligi?: (veri: T) => string;
  /** Eşzamanlılık ortam değişkeni (varsayılan TARAMA_ESZAMANLI). */
  eszamanliDegiskeni?: string;
}

const PLANLA = "planla";

export function taramaKuyruguEtkin(): boolean {
  return process.env.TEKIR_WORKER === "1" && !!process.env.REDIS_URL && process.env.NODE_ENV !== "test" && process.env.TARAMA_KUYRUGU_KAPALI !== "1";
}

export class TaramaKuyrugu<T extends { tenantId: string }> {
  private readonly logger: Logger;
  private readonly kuyruk: Queue;
  private worker?: Worker;

  constructor(private readonly ayar: TaramaKuyruguAyari<T>) {
    this.logger = new Logger(`TaramaKuyrugu:${ayar.tur}`);
    this.kuyruk = new Queue(`tekirextra-tarama-${ayar.tur}`, {
      connection: redisBaglantisi(),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
  }

  async baslat(): Promise<void> {
    const eszamanli = Math.max(1, Math.min(8, Number(process.env[this.ayar.eszamanliDegiskeni ?? "TARAMA_ESZAMANLI"] || 2) || 2));
    this.worker = new Worker(this.kuyruk.name, (is) => this.isle(is), { connection: redisBaglantisi(), concurrency: eszamanli });
    this.worker.on("error", (hata) => this.logger.error(JSON.stringify({ event: "scan_queue_worker_error", tur: this.ayar.tur, error: hata.message })));
    await this.worker.waitUntilReady();
    // Her worker aynı zamanlayıcıyı "upsert" eder; tek kayıt kalır. İlk tur zamanlayıcı kurulunca hemen düşer;
    // ayrıca açılışta planlamak her yeniden başlatmada sahte "tur atlandı" alarmı üretirdi.
    await this.kuyruk.upsertJobScheduler(PLANLA, { every: this.ayar.aralikMs }, { name: PLANLA, data: {} });
    this.logger.log(JSON.stringify({ event: "scan_queue_started", tur: this.ayar.tur, intervalMs: this.ayar.aralikMs, concurrency: eszamanli }));
  }

  async kapat(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.kuyruk.close().catch(() => undefined);
  }

  private async isle(is: Job): Promise<void> {
    if (is.name === PLANLA) {
      await nabizla(this.ayar.nabizAdi, () => this.planlaVeEkle(true), this.ayar.aralikMs, { tekSurec: false });
      return;
    }
    await this.ayar.isle(is.data as T);
  }

  /** Planlar ve ekler; önceki turdan kalan iş varsa turu "atlandı" kaydeder. */
  async planlaVeEkle(isIcinden: boolean): Promise<{ eklenen: number; bekleyen: number }> {
    const sayilar = await this.kuyruk.getJobCounts("waiting", "active", "prioritized");
    // İş içinden çağrıldıysa planlayıcının kendisi de etkin iş sayılır.
    const bekleyen = Math.max(0, (sayilar.waiting ?? 0) + (sayilar.prioritized ?? 0) + (sayilar.active ?? 0) - (isIcinden ? 1 : 0));
    if (bekleyen > 0) {
      await nabizAtlandi(this.ayar.nabizAdi, this.ayar.aralikMs);
      this.logger.warn(JSON.stringify({ event: "scan_queue_backlog", tur: this.ayar.tur, bekleyen }));
    }
    const isler = await this.ayar.planla();
    if (isler.length) {
      await this.kuyruk.addBulk(isler.map((veri) => ({ name: this.ayar.tur, data: veri, opts: { jobId: this.ayar.isKimligi?.(veri) ?? veri.tenantId } })));
    }
    return { eklenen: isler.length, bekleyen };
  }
}
