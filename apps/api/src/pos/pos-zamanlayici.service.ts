import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PosService } from "./pos.service";
import { nabizla } from "../core/nabiz/nabiz";

const BIR_SAAT_MS = 60 * 60 * 1000;

/**
 * P1-6: süresi dolan ödeme bağlantılarını worker'da saatlik kapatır. Liste
 * ekranı da açılırken aynı kapatmayı yapar; bu görev ekran açılmasa da
 * durumların doğru kalmasını sağlar.
 */
@Injectable()
export class PosZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly pos: PosService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("pos-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("pos-zamanlayici", () => this.calistir()), BIR_SAAT_MS);
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("POS süre kontrolü için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((t) => t.id); }
    finally { await yonetim.$disconnect(); }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      let toplam = 0;
      for (const tenantId of await this.tenantIdleriAl()) toplam += await this.pos.suresiDolanlariKapat(tenantId);
      if (toplam) this.logger.log(`${toplam} ödeme bağlantısının süresi doldu`);
    } catch (hata) {
      this.logger.error("POS bağlantı süre kontrolü başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally {
      this.calisiyor = false;
    }
  }
}
