import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { OdemeSozuService } from "./odeme-sozu.service";

@Controller("cari/odeme-sozleri")
export class OdemeSozuController {
  constructor(@Inject(OdemeSozuService) private readonly servis: OdemeSozuService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @Roller("muhasebe", "mali_musavir", "salt_okunur")
  listele(@Query() sorgu: unknown) { return this.servis.listele(sorgu); }

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) { return this.servis.olustur(govde); }

  @Post(":id/revize")
  @Roller("muhasebe")
  revize(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.servis.revize(id, govde); }

  @Post(":id/iptal")
  @Roller("muhasebe")
  iptal(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.servis.iptal(id, govde); }
}
