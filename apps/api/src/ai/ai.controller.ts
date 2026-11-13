import { Controller, Post, Body, BadRequestException, HttpCode, Param, ParseUUIDPipe } from "@nestjs/common";
import { AiService } from "./ai.service";
import { aiBelgeGirdiSemasi } from "./ai.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";
import { cekOcrGirdiSemasi } from "./cek-ocr";
import { PrismaService } from "../core/prisma.service";
import { ocrSonucSemasi, ocrSonucuBagla } from "./ocr-kaydi";

/** AI-02: OCR sonucu masraf ve cari formunu doldurur; o formları açan rol. */
@Controller("ai")
@Roller("muhasebe")
export class AiController {
  constructor(private readonly aiService: AiService, private readonly prisma: PrismaService) {}

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

  /** AI-13: taramadan oluşan masraf(lar) ya da cari tarama kaydına bağlanır. */
  @Post("ocr/kayitlar/:id/sonuc")
  @HttpCode(204)
  async ocrSonucu(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const s = ocrSonucSemasi.safeParse(body);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
    await this.prisma.tenantIslem(aktifBaglam().tenantId, (tx) => ocrSonucuBagla(tx, id, s.data));
  }
}
