import { Controller, Get, Query } from "@nestjs/common";
import { RaporService } from "./rapor.service";

/**
 * Panel özet göstergeleri (RPR-01). Modül raporları RPR-06 ortak araç
 * setindedir (/raporlar); eski kar-zarar ucu fatura.kar-marji olarak taşındı.
 */
@Controller("rapor")
export class RaporController {
  constructor(private readonly raporService: RaporService) {}

  @Get("ozet")
  async finansalOzet() {
    return this.raporService.finansalOzet();
  }

  @Get("gunluk")
  async gunlukOzet(@Query("tarih") tarih?: string) {
    return this.raporService.gunlukOzet(tarih);
  }

  @Get("vadesi-gecenler")
  async vadesiGecenler() {
    return this.raporService.vadesiGecenler();
  }

  @Get("smm")
  async smmAnalizi(@Query("yontem") yontem?: "agirlikli_ortalama" | "fifo") {
    return this.raporService.smmAnalizi(yontem);
  }

  @Get("gelir-gider")
  async gelirGiderRaporu(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
  ) {
    return this.raporService.gelirGiderRaporu(baslangic, bitis);
  }
}
