import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { AiOnayService } from "./ai-onay.service";

/** AI-04: kullanıcının yapay zekâ işlemi onay talepleri; yalnız kendi talepleri. */
@Controller("ai/onay-talepleri")
export class AiOnayController {
  constructor(private readonly service: AiOnayService) {}

  @Get()
  listele(@Query("durum") durum?: string) {
    return this.service.listele(durum);
  }

  /** AI-107: kart gördüğü `surum`u gönderir; farklıysa 409 ESKI_SURUM. */
  @Post(":id/onayla")
  onayla(@Param("id", ParseUUIDPipe) id: string, @Body() govde?: { surum?: unknown }) {
    return this.service.onayla(id, { surum: surumAl(govde), kanal: "WEB" });
  }

  @Post(":id/reddet")
  reddet(@Param("id", ParseUUIDPipe) id: string, @Body() govde?: { surum?: unknown }) {
    return this.service.reddet(id, { surum: surumAl(govde), kanal: "WEB" });
  }

  /** AI-107: karttan izinli alanların düzenlenmesi (yeni sürüm). */
  @Post(":id/duzenle")
  duzenle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: { surum?: unknown; degerler?: unknown }) {
    return this.service.duzenle(id, govde ?? {});
  }
}

const surumAl = (g?: { surum?: unknown }) => (typeof g?.surum === "number" && Number.isInteger(g.surum) ? g.surum : undefined);
