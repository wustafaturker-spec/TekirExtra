import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { SatinAlmaService } from "./satin-alma.service";
import { iptalSemasi, idSemasi, kapsamSemasi, onaySemasi, redSemasi, siparisSemasi, talepSemasi, teklifSecSemasi, teklifSemasi } from "./satin-alma.semalar";

/**
 * SAT-02: salt okunur, mali müşavir ve bayi dışındaki roller talep açar
 * (yönetici her uca geçer). Kim neyi görür ve onaylar serviste denetlenir;
 * teklif ve sipariş uçları muhasebe/yöneticiye kapalı tutulur.
 */
@Controller("satin-alma")
@Roller("muhasebe", "satis", "depo", "uretim_planlama", "uretim_operatoru", "kalite", "maliyet_muhasebesi")
export class SatinAlmaController {
  constructor(private readonly service: SatinAlmaService) {}

  @Get("secenekler")
  secenekler() {
    return this.service.secenekler();
  }

  @Get("talepler")
  listele(@Query("kapsam") kapsam?: string) {
    return this.service.listele(kapsamSemasi.parse(kapsam));
  }

  @Get("talepler/:id")
  getir(@Param("id") id: string) {
    return this.service.getir(idSemasi.parse(id));
  }

  @Post("talepler")
  olustur(@Body() govde: unknown) {
    return this.service.olustur(talepSemasi.parse(govde));
  }

  @Put("talepler/:id")
  guncelle(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.guncelle(idSemasi.parse(id), talepSemasi.parse(govde));
  }

  @Post("talepler/:id/gonder")
  gonder(@Param("id") id: string) {
    return this.service.gonder(idSemasi.parse(id));
  }

  @Post("talepler/:id/geri-cek")
  geriCek(@Param("id") id: string) {
    return this.service.geriCek(idSemasi.parse(id));
  }

  @Post("talepler/:id/iptal")
  iptal(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.iptal(idSemasi.parse(id), iptalSemasi.parse(govde ?? {}).gerekce);
  }

  @Post("talepler/:id/onayla")
  onayla(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.onayla(idSemasi.parse(id), onaySemasi.parse(govde ?? {}).butceAsimGerekcesi);
  }

  @Post("talepler/:id/reddet")
  reddet(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.reddet(idSemasi.parse(id), redSemasi.parse(govde ?? {}).gerekce);
  }

  @Post("talepler/:id/teklifler")
  @Roller("muhasebe")
  teklifEkle(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.teklifEkle(idSemasi.parse(id), teklifSemasi.parse(govde));
  }

  @Delete("teklifler/:teklifId")
  @Roller("muhasebe")
  teklifSil(@Param("teklifId") teklifId: string) {
    return this.service.teklifSil(idSemasi.parse(teklifId));
  }

  @Post("teklifler/:teklifId/sec")
  @Roller("muhasebe")
  teklifSec(@Param("teklifId") teklifId: string, @Body() govde: unknown) {
    return this.service.teklifSec(idSemasi.parse(teklifId), teklifSecSemasi.parse(govde ?? {}).gerekce);
  }

  @Post("talepler/:id/siparis")
  @Roller("muhasebe")
  siparisOlustur(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.siparisOlustur(idSemasi.parse(id), siparisSemasi.parse(govde ?? {}));
  }
}
