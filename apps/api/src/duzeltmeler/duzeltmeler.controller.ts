import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { DuzeltmelerService } from "./duzeltmeler.service";
import { duzeltmeAtaSemasi, duzeltmeDurumSemasi, duzeltmeListeSemasi, duzeltmeNotSemasi } from "./duzeltmeler.semalar";

@Controller("duzeltmeler")
@Roller("yonetici", "muhasebe", "salt_okunur", "mali_musavir")
export class DuzeltmelerController {
  constructor(private readonly service: DuzeltmelerService) {}

  @Get()
  listele(@Query() sorgu: unknown) { return this.service.listele(duzeltmeListeSemasi.parse(sorgu)); }

  @Get("ozet")
  ozet() { return this.service.ozet(); }

  @Get("secenekler")
  secenekler() { return this.service.secenekler(); }

  @Get(":id")
  getir(@Param("id") id: string) { return this.service.getir(id); }

  @Post("tara")
  @Roller("yonetici", "muhasebe")
  tara() { return this.service.tara(); }

  @Patch(":id/ata")
  @Roller("yonetici", "muhasebe")
  ata(@Param("id") id: string, @Body() govde: unknown) { return this.service.ata(id, duzeltmeAtaSemasi.parse(govde).userId); }

  @Post(":id/notlar")
  @Roller("yonetici", "muhasebe")
  notEkle(@Param("id") id: string, @Body() govde: unknown) { return this.service.notEkle(id, duzeltmeNotSemasi.parse(govde).aciklama); }

  @Patch(":id/durum")
  @Roller("yonetici", "muhasebe")
  durumDegistir(@Param("id") id: string, @Body() govde: unknown) {
    const girdi = duzeltmeDurumSemasi.parse(govde);
    return this.service.durumDegistir(id, girdi.durum, girdi.aciklama);
  }
}
