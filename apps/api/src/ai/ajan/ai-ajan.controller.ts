import { Body, Controller, Get, Post } from "@nestjs/common";
import { AiAjanService } from "./ai-ajan.service";

/**
 * AI-05: panel asistanı. Kimlik ve rol yalnız oturumdan gelir. Dış kanal
 * (WhatsApp vb.) webhook'u bu pakette yoktur (AI-10).
 */
@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  @Post("mesaj")
  mesaj(@Body() body: { mesaj?: unknown }) {
    return this.ajanService.mesajiIsle(typeof body?.mesaj === "string" ? body.mesaj : "");
  }

  @Get("gecmis")
  gecmis() {
    return this.ajanService.gecmis();
  }
}
