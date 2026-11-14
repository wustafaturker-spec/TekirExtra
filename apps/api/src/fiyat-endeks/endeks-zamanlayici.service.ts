import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { nabizla } from "../core/nabiz/nabiz";
import { EndeksService } from "./endeks.service";

/** TÜİK aylık endeksleri ayın 3'ü civarı 10:00'da açıklar; günde dört tur yayından sonra en geç 6 saatte yakalar. */
const ARALIK_MS = 6 * 60 * 60 * 1000;
const ACILIS_GECIKMESI_MS = 60_000;

/**
 * END-03: worker içinde ortak endeks serilerini çeker (kiracı başına değil).
 * Hata `Logger.error` ile nabız kaydına ve sistem hata gruplarına (PLT-123) düşer.
 */
@Injectable()
export class EndeksZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EndeksZamanlayiciService.name);
  private ilk?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;

  constructor(private readonly endeks: EndeksService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.ilk = setTimeout(() => void this.tur(), ACILIS_GECIKMESI_MS);
    this.zamanlayici = setInterval(() => void this.tur(ARALIK_MS), ARALIK_MS);
  }

  onModuleDestroy(): void {
    if (this.ilk) clearTimeout(this.ilk);
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async tur(aralikMs?: number): Promise<void> {
    await nabizla("endeks-cekimi", async () => {
      if (!this.endeks.anahtarTanimli()) {
        this.logger.warn("TCMB_EVDS_API_KEY tanımlı değil; endeks çekimi yapılmadı.");
        return;
      }
      const sonuclar = await this.endeks.cek();
      const hatali = sonuclar.filter((s) => !s.basarili);
      if (hatali.length) this.logger.error(`Endeks çekimi: ${hatali.map((s) => `${s.kod}: ${s.hata}`).join("; ")}`);
    }, aralikMs);
  }
}
