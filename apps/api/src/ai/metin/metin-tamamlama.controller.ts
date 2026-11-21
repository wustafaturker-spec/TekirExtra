import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { SaltOkumadaAcik } from "../../auth/public.decorator";
import { MetinTamamlamaService } from "./metin-tamamlama.service";

/** AI-115: metin alanında öneri ve yeniden yazma; kayıt oluşturmaz (salt okunur kipte de açık). */
@Controller("ai/metin")
export class MetinTamamlamaController {
  constructor(private readonly service: MetinTamamlamaService) {}

  @Get("durum")
  durum() {
    return this.service.durum();
  }

  @Put("tercih")
  tercih(@Body() govde: { acik?: unknown }) {
    return this.service.tercihKaydet(govde?.acik);
  }

  @SaltOkumadaAcik()
  @Post("oneri")
  @HttpCode(200)
  oneri(@Body() govde: unknown) {
    return this.service.oneri(govde);
  }

  @SaltOkumadaAcik()
  @Post("yeniden-yaz")
  @HttpCode(200)
  yenidenYaz(@Body() govde: unknown) {
    return this.service.yenidenYaz(govde);
  }
}
