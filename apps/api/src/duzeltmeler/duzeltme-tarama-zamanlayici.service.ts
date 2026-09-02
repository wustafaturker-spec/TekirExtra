import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { DuzeltmelerService } from "./duzeltmeler.service";

const ON_BES_DAKIKA_MS = 15 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/** Worker içinde tüm tenantların düzeltme dedektörlerini en geç 15 dakikada bir çalıştırır. */
@Injectable()
export class DuzeltmeTaramaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuzeltmeTaramaZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly duzeltmeler: DuzeltmelerService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void this.calistir());
    const ayar = Number(process.env.DUZELTME_TARAMA_INTERVAL_MS || ON_BES_DAKIKA_MS);
    const aralik = Math.min(Number.isFinite(ayar) && ayar > 0 ? ayar : ON_BES_DAKIKA_MS, ON_BES_DAKIKA_MS);
    this.zamanlayici = setInterval(() => void this.calistir(), aralik);
    this.logger.log(`Düzeltme dedektörleri ${Math.round(aralik / 1000)} saniyelik aralıkla planlandı`);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private async tenantIdleriAl(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Otomatik düzeltme taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((tenant) => tenant.id); }
    finally { await yonetim.$disconnect(); }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      let bulunan = 0; let otomatikCozulen = 0;
      for (const tenantId of await this.tenantIdleriAl()) {
        const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.duzeltmeler.tara());
        bulunan += sonuc.bulunan; otomatikCozulen += sonuc.otomatikCozulen;
      }
      this.logger.debug(`Otomatik düzeltme taraması tamamlandı: ${bulunan} bulgu, ${otomatikCozulen} otomatik çözüm`);
    } catch (hata) {
      this.logger.error("Otomatik düzeltme taraması başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally { this.calisiyor = false; }
  }
}
