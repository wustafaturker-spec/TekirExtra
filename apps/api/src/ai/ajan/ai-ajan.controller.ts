import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AiAjanService } from "./ai-ajan.service";

/**
 * AI-05: panel asistanı. Kimlik ve rol yalnız oturumdan gelir. Dış kanal
 * (WhatsApp vb.) webhook'u bu pakette yoktur (AI-10).
 */
@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  @Post("mesaj")
  mesaj(@Body() body: { mesaj?: unknown; requestId?: unknown; baglam?: { cariId?: unknown } }) {
    const cariId = body?.baglam?.cariId;
    return this.ajanService.mesajiIsle(
      typeof body?.mesaj === "string" ? body.mesaj : "",
      typeof body?.requestId === "string" ? body.requestId : undefined,
      // CARI-48: panelden açılan asistan; kimlik sunucuda doğrulanır.
      typeof cariId === "string" ? { cariId } : undefined,
    );
  }

  @Get("gecmis")
  gecmis(@Query("oturumId") oturumId?: string) {
    return this.ajanService.gecmis(oturumId);
  }

  @Post("mesajlar/:id/geri-bildirim")
  geriBildirim(@Param("id") id: string, @Body() body: unknown) {
    return this.ajanService.geriBildirim(id, body);
  }

  @Get("sohbetler")
  sohbetler() {
    return this.ajanService.sohbetler();
  }

  @Post("sohbetler/yeni")
  yeniSohbet() {
    return this.ajanService.yeniSohbet();
  }

  @Post("sohbetler/:id/etkinlestir")
  sohbetEtkinlestir(@Param("id") id: string) {
    return this.ajanService.sohbetEtkinlestir(id);
  }

  @Post("sohbetler/:id/arsivle")
  sohbetArsivle(@Param("id") id: string) {
    return this.ajanService.sohbetArsivle(id);
  }
}
