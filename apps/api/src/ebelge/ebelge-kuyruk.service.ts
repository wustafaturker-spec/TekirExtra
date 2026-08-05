import { Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import { EbelgeService } from "./ebelge.service";

@Injectable()
export class EbelgeKuyrukService {
  private readonly logger = new Logger(EbelgeKuyrukService.name);
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 5000; // 5 saniye

  // EbelgeService → FaturaService → EbelgeKuyrukService → EbelgeService
  // döngüsünde sınıf referansı çözülme anında tanımsız kalıyor; forwardRef
  // çözümü modül kurulumuna erteler.
  constructor(
    @Inject(forwardRef(() => EbelgeService))
    private readonly ebelgeService: EbelgeService,
  ) {}

  /**
   * e-Belge gönderimini asenkron olarak kuyruğa ekler ve arka planda çalıştırır (EBLG-03).
   * v1.0 dev/test redis-bağımsız bellek-içi (in-memory) kuyruk mekanizması (NFR-03).
   */
  kuyrugaEkle(faturaId: string) {
    this.logger.log(`Fatura ${faturaId} e-belge gönderim kuyruğuna eklendi.`);
    // Arka planda gecikmeli olarak başlat
    setTimeout(() => {
      void this.isGoster(faturaId, 1);
    }, 1000);
  }

  private async isGoster(faturaId: string, denemeSayisi: number) {
    try {
      this.logger.log(
        `Fatura ${faturaId} için gönderim başlatılıyor. Deneme: ${denemeSayisi}/${this.maxRetries}`,
      );
      
      const sonuc = await this.ebelgeService.gonder(faturaId);

      if (sonuc.basarili) {
        this.logger.log(
          `Fatura ${faturaId} e-belge gönderimi başarıyla tamamlandı. Ref: ${sonuc.ebelgeRef}`,
        );
      } else {
        throw new Error(sonuc.hataMesaji || "Bilinmeyen gönderim hatası");
      }
    } catch (hata: any) {
      this.logger.error(
        `Fatura ${faturaId} gönderiminde hata oluştu: ${hata.message}`,
      );

      if (denemeSayisi < this.maxRetries) {
        this.logger.log(
          `Fatura ${faturaId} ${this.retryDelayMs / 1000} saniye sonra tekrar denenecek...`,
        );
        setTimeout(() => {
          void this.isGoster(faturaId, denemeSayisi + 1);
        }, this.retryDelayMs);
      } else {
        this.logger.error(
          `Fatura ${faturaId} maksimum deneme sayısına (${this.maxRetries}) ulaştı. Gönderim başarısız.`,
        );
      }
    }
  }
}
