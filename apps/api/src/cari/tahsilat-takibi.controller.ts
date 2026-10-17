import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { TahsilatTakibiService } from "./tahsilat-takibi.service";
@Controller("cari/tahsilat-takipleri")
@Roller("muhasebe", "mali_musavir", "salt_okunur")
export class TahsilatTakibiController {
  constructor(@Inject(TahsilatTakibiService) private readonly servis: TahsilatTakibiService) {}
  @Get() @Header("Cache-Control", "no-store")
  listele(@Query() sorgu: unknown) { return this.servis.listele(sorgu); }
  @Get("sorumlular") @Header("Cache-Control", "no-store")
  sorumlular() { return this.servis.sorumlular(); }
  @Get(":id") @Header("Cache-Control", "no-store")
  getir(@Param("id", ParseUUIDPipe) id: string) { return this.servis.getir(id); }
  @Post() @Roller("muhasebe")
  olustur(@Body() g: unknown) { return this.servis.olustur(g); }
  @Patch(":id") @Roller("muhasebe")
  guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.servis.guncelle(id, g); }
  @Post(":id/gorusmeler") @Roller("muhasebe")
  gorusme(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.servis.gorusmeEkle(id, g); }
}
