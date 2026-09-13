import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DovizService } from "./doviz.service";

const BIR_GUN_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_UTC_FARKI_MS = 3 * 60 * 60 * 1000;

/** TCMB kurları 15:30 civarı yayımlar; çekim yayımdan sonra, İstanbul saatiyle 16:05. */
function sonrakiCekimMs(simdiMs = Date.now()): number {
  const istanbul = new Date(simdiMs + ISTANBUL_UTC_FARKI_MS);
  let hedefMs = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate(), 16, 5) - ISTANBUL_UTC_FARKI_MS;
  if (hedefMs <= simdiMs) hedefMs += BIR_GUN_MS;
  return hedefMs - simdiMs;
}

/**
 * DVZ-02: worker içinde TCMB kurlarını günde bir kez çeker; ekranların
 * istemesini beklemez. Çekim kiracı başına değil, ortak tabloya bir kez yapılır.
 * Açılışta da çalışır: worker kapalıyken kaçan günler geriye bakış penceresinde tamamlanır.
 */
@Injectable()
export class DovizZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DovizZamanlayiciService.name);
  private ilkCekim?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly doviz: DovizService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void this.calistir());
    this.ilkCekim = setTimeout(() => {
      void this.calistir();
      this.zamanlayici = setInterval(() => void this.calistir(), BIR_GUN_MS);
    }, sonrakiCekimMs());
    this.logger.log("TCMB kur çekimi her gün İstanbul saatiyle 16:05 için planlandı");
  }

  onModuleDestroy(): void {
    if (this.ilkCekim) clearTimeout(this.ilkCekim);
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      await this.doviz.gunlukCek();
    } catch (hata) {
      this.logger.error("TCMB kur çekimi başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally {
      this.calisiyor = false;
    }
  }
}
