import { Controller, Get } from "@nestjs/common";
import { Roller } from "../../auth/roller.decorator";
import { AiRaporService } from "./ai-rapor.service";

/** AI-02/AI-08: finansal özet rolleri (RPR-11 `GET /rapor/ozet` ile aynı). */
@Controller("ai/rapor")
@Roller("muhasebe", "mali_musavir", "salt_okunur")
export class AiRaporController {
  constructor(private readonly raporService: AiRaporService) {}

  @Get("yonetici-ozeti")
  yoneticiOzeti() {
    return this.raporService.yoneticiOzeti();
  }
}
