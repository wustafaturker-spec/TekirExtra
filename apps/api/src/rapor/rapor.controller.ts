import { Controller, Get } from "@nestjs/common";
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
}
