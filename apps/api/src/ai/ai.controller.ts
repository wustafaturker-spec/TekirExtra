import { Controller, Post, Body, BadRequestException } from "@nestjs/common";
import { AiService } from "./ai.service";
import { aiBelgeGirdiSemasi } from "./ai.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";
import { cekOcrGirdiSemasi } from "./cek-ocr";

/** AI-02: OCR sonucu masraf ve cari formunu doldurur; o formları açan rol. */
@Controller("ai")
@Roller("muhasebe")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("cek/oku")
  async cekOku(@Body() body: unknown) {
    const veri = cekOcrGirdiSemasi.safeParse(body);
    if (!veri.success) throw new BadRequestException("Geçerli bir JPEG, PNG veya WebP çek görüntüsü gerekli");
    return this.aiService.cekOcrTara(aktifBaglam().tenantId, veri.data);
  }

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
