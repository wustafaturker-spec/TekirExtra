import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { AiOnayService } from "./ai-onay.service";

/** AI-04: kullanıcının yapay zekâ işlemi onay talepleri; yalnız kendi talepleri. */
@Controller("ai/onay-talepleri")
export class AiOnayController {
  constructor(private readonly service: AiOnayService) {}

  @Get()
  listele(@Query("durum") durum?: string) {
    return this.service.listele(durum);
  }

  @Post(":id/onayla")
  onayla(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.onayla(id);
  }

  @Post(":id/reddet")
  reddet(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.reddet(id);
  }
}
