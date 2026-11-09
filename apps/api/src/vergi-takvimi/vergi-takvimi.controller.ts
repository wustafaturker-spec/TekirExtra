import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { vergiAyarSemasi, vergiBeyanSemasi, vergiHareketSorguSemasi, vergiOdemeSemasi, vergiTakvimSorguSemasi } from "./vergi-takvimi.semalar";
import { VergiTakvimiService } from "./vergi-takvimi.service";

/** VTK-01: vergi raporuyla aynı okuma rolleri; mali müşavir yazamaz. */
@Controller("rapor/vergi-takvimi")
@Roller("yonetici", "muhasebe", "mali_musavir")
export class VergiTakvimiController {
  constructor(private readonly servis: VergiTakvimiService) {}

  @Get()
  liste(@Query() sorgu: unknown) {
    return this.servis.liste(vergiTakvimSorguSemasi.parse(sorgu).yil);
  }

  @Get("hareketler")
  @Roller("yonetici", "muhasebe")
  hareketler(@Query() sorgu: unknown) {
    return this.servis.hareketler(vergiHareketSorguSemasi.parse(sorgu));
  }

  @Put("ayar")
  @Roller("yonetici", "muhasebe")
  ayar(@Body() govde: unknown) {
    return this.servis.ayarKaydet(vergiAyarSemasi.parse(govde));
  }

  @Put("beyan")
  @Roller("yonetici", "muhasebe")
  beyan(@Body() govde: unknown) {
    return this.servis.beyanKaydet(vergiBeyanSemasi.parse(govde));
  }

  @Post("odeme")
  @Roller("yonetici", "muhasebe")
  odeme(@Body() govde: unknown) {
    return this.servis.odemeEkle(vergiOdemeSemasi.parse(govde));
  }

  @Delete("odeme/:id")
  @Roller("yonetici", "muhasebe")
  odemeSil(@Param("id", ParseUUIDPipe) id: string) {
    return this.servis.odemeSil(id);
  }
}
