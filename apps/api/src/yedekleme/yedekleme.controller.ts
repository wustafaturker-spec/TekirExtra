import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { YedeklemeService } from "./yedekleme.service";

const sayfaSemasi = z.object({ sayfa: z.coerce.number().int().min(1).max(100000).default(1) });
const talepSemasi = z.object({ neden: z.string().trim().min(5, "Neden en az 5 karakter olmalı.").max(500), totpKodu: z.string().trim().regex(/^\d{6}$/, "Doğrulama kodu 6 haneli olmalı.") });
const koruSemasi = z.object({ korunuyor: z.boolean() });

/** PLT-112/113/116: `PlatformUcu` yalnız platform yöneticisine açıktır. */
@PlatformUcu()
@Controller("platform/yedekler")
export class YedeklemeController {
  constructor(private readonly servis: YedeklemeService) {}

  @Get()
  ekran(@Query() sorgu: unknown) {
    return this.servis.ekran(sayfaSemasi.parse(sorgu).sayfa);
  }

  @Post()
  talepEt(@Body() govde: unknown) {
    const { neden, totpKodu } = talepSemasi.parse(govde);
    return this.servis.talepEt(neden, totpKodu);
  }

  @Post(":id/koru")
  @HttpCode(200)
  koru(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.servis.koru(id, koruSemasi.parse(govde).korunuyor);
  }

  @Post(":id/geri-yukleme-denemesi")
  @HttpCode(200)
  denemeIste(@Param("id", ParseUUIDPipe) id: string) {
    return this.servis.denemeIste(id);
  }
}
