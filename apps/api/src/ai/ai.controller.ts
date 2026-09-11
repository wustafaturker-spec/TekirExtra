import { Controller, Post, Body } from "@nestjs/common";
import { AiService } from "./ai.service";
import { ocrTaramaSemasi } from "./ai.semalar";
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
}
