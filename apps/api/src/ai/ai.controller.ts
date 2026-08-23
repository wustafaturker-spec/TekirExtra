import { Controller, Post, Get, Body, Query } from "@nestjs/common";
import { AiService } from "./ai.service";
import { ocrTaramaSemasi, aiTahminSemasi } from "./ai.semalar";
import { aktifBaglam } from "../core/istek-baglami";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("ocr/tara")
  async fisFaturaOcrTara(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = ocrTaramaSemasi.parse(body);
    return this.aiService.fisFaturaOcrTara(tenantId, veri);
  }

  @Get("nakit-akis-tahmini")
  async nakitAkisTahmini(@Query("gun") gun?: string) {
    const { tenantId } = aktifBaglam();
    const girdi = aiTahminSemasi.parse({ tarihAraligiGun: gun ? Number(gun) : 30 });
    return this.aiService.nakitAkisTahmini(tenantId, girdi);
  }
}
