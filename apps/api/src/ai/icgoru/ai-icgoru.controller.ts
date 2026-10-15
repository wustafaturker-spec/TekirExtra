import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Roller } from "../../auth/roller.decorator";
import { AiIcgoruService } from "./ai-icgoru.service";

/** AI-25: nakit akışı ekranıyla aynı roller (NAK-13). */
@Controller("ai/icgoruler")
@Roller("muhasebe")
export class AiIcgoruController {
  constructor(private readonly service: AiIcgoruService) {}

  @Get()
  listele(@Query("tumu") tumu?: string) {
    return this.service.listele(tumu === "1");
  }

  /** "Şimdi analiz et": kullanıcının kimliğiyle, günde tek kayıt. */
  @Post("analiz")
  analiz() {
    return this.service.analizEt({ gorevId: null });
  }

  @Patch(":id/durum")
  durum(@Param("id", ParseUUIDPipe) id: string, @Body() girdi: unknown) {
    return this.service.durumGuncelle(id, girdi);
  }
}
