import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PlatformUcu } from "../auth/public.decorator";
import { SistemSagligiService } from "./sistem-sagligi.service";

/** PLT-17/18: işaretsiz platform ucu; yalnız platform yöneticisine açık. */
@PlatformUcu()
@Controller("platform/sistem-sagligi")
export class SistemSagligiController {
  constructor(private readonly saglik: SistemSagligiService) {}

  @Get()
  ekran() {
    return this.saglik.ekran();
  }

  @Post("olu-isler/:id/yeniden-dene")
  @HttpCode(200)
  yenidenDene(@Param("id") id: string) {
    return this.saglik.yenidenDene(id);
  }
}
