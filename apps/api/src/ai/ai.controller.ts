import { Controller, Post, Body } from "@nestjs/common";
import { AiService } from "./ai.service";
import { aiBelgeGirdiSemasi } from "./ai.semalar";
import { aktifBaglam } from "../core/istek-baglami";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Fiş veya Fatura Görselini/Metnini Taramak ve Masraf/Fatura Taslağı Çıkarmak
   */
  @Post("ocr/tara")
  async fisFaturaOcrTara(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = aiBelgeGirdiSemasi.parse(body);
    return this.aiService.fisFaturaOcrTara(tenantId, veri);
  }

  /**
   * E-posta İmzasından, Kartvizit Görselinden veya Metinden Cari Hesap Bilgisi Çıkarmak
   */
  @Post("cari/cikar")
  async cariBilgisiCikar(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = aiBelgeGirdiSemasi.parse(body);
    return this.aiService.cariBilgisiCikar(tenantId, veri);
  }
}
