import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { ButceService } from "./butce.service";
import { butceOlusturSemasi, butceSatirlariSemasi, revizyonAcSemasi, yilSemasi } from "./butce.semalar";

/** BUT-09: yalnız yönetici ve muhasebe; onay yalnız yönetici (BUT-06). */
@Controller("butce")
@Roller("muhasebe")
export class ButceController {
  constructor(private readonly service: ButceService) {}

  @Get(":yil")
  getir(@Param("yil") yil: string) {
    return this.service.getir(yilSemasi.parse(yil));
  }

  @Get(":yil/karsilastirma")
  karsilastirma(@Param("yil") yil: string) {
    return this.service.karsilastirma(yilSemasi.parse(yil));
  }

  @Post(":yil")
  olustur(@Param("yil") yil: string, @Body() govde: unknown) {
    return this.service.olustur(yilSemasi.parse(yil), butceOlusturSemasi.parse(govde ?? {}));
  }

  @Post(":yil/revizyon")
  revizyonAc(@Param("yil") yil: string, @Body() govde: unknown) {
    return this.service.revizyonAc(yilSemasi.parse(yil), revizyonAcSemasi.parse(govde).gerekce);
  }

  @Put("revizyon/:id/satirlar")
  satirlariKaydet(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.satirlariKaydet(id, butceSatirlariSemasi.parse(govde).satirlar);
  }

  @Post("revizyon/:id/onayla")
  @Roller("yonetici")
  onayla(@Param("id") id: string) {
    return this.service.onayla(id);
  }
}
