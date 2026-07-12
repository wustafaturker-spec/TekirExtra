import { Controller, Get } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { RaporService } from "./rapor.service";

@Controller("rapor")
export class RaporController {
  constructor(private readonly raporService: RaporService) {}

  @Get("kar-zarar")
  @Roller("muhasebe", "yonetici")
  async karZararRaporu() {
    return this.raporService.karZararRaporu();
  }

  @Get("ozet")
  async finansalOzet() {
    return this.raporService.finansalOzet();
  }
}
