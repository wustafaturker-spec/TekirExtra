import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { DonemKapatmaService } from "./donem-kapatma.service";
import { donemAcSemasi, donemKapatSemasi, donemSecimSemasi } from "./donem-kapatma.semalar";
import { SaltOkumadaAcik } from "../auth/public.decorator";

@Controller("donem-kapatma")
@Roller("muhasebe")
export class DonemKapatmaController {
  constructor(private readonly service: DonemKapatmaService) {}

  @Get() listele() { return this.service.listele(); }
  @Get(":id/kanit") kanit(@Param("id") id: string) { return this.service.kanitPaketi(id); }
  @SaltOkumadaAcik() @Post("kontroller") kontrol(@Query() sorgu: unknown) { const g = donemSecimSemasi.parse(sorgu); return this.service.kontrolleriCalistir(g.yil, g.ay); }
  @Post("kapat") @Roller("yonetici") kapat(@Body() govde: unknown) { const g = donemKapatSemasi.parse(govde); return this.service.kapat(g.yil, g.ay, g.gerekce); }
  @Post(":id/yeniden-ac") @Roller("yonetici") ac(@Param("id") id: string, @Body() govde: unknown) { const g = donemAcSemasi.parse(govde); return this.service.yenidenAc(id, g.gerekce, g.totpKodu); }
}
