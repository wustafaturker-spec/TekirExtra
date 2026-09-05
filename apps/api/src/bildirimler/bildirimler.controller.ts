import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { BildirimEpostaService } from "./bildirim-eposta.service";
import { BildirimService } from "./bildirim.service";
import { BildirimUreticiService } from "./bildirim-uretici.service";
import {
  bildirimAksiyonSemasi,
  bildirimListeSemasi,
  bildirimOkunduSemasi,
  bildirimTercihSemasi,
  sessizSaatSemasi,
} from "./bildirimler.semalar";

/**
 * Kullanıcı yalnız kendi teslimatlarını görür; rol kısıtı bu yüzden sınıf
 * düzeyinde yoktur (BLD-09). Firma geneli kapsamı servis içinde yöneticiye
 * kilitlidir, elle tarama ise muhasebe/yöneticiye.
 */
@Controller("bildirimler")
export class BildirimlerController {
  constructor(
    private readonly service: BildirimService,
    private readonly uretici: BildirimUreticiService,
    private readonly eposta: BildirimEpostaService,
  ) {}

  @Get()
  listele(@Query() sorgu: unknown) {
    return this.service.listele(bildirimListeSemasi.parse(sorgu));
  }

  @Get("ozet")
  ozet() {
    return this.service.ozet();
  }

  @Get("tercihler")
  tercihler() {
    return this.service.tercihleriGetir();
  }

  @Put("tercihler")
  tercihKaydet(@Body() govde: unknown) {
    return this.service.tercihKaydet(bildirimTercihSemasi.parse(govde));
  }

  @Put("sessiz-saat")
  sessizSaat(@Body() govde: unknown) {
    const girdi = sessizSaatSemasi.parse(govde);
    return this.service.sessizSaatKaydet(girdi.baslangic, girdi.bitis);
  }

  @Post("okundu")
  okundu(@Body() govde: unknown) {
    return this.service.okunduIsaretle(bildirimOkunduSemasi.parse(govde).ids);
  }

  @Post("tumunu-okundu")
  tumunuOkundu() {
    return this.service.tumunuOkunduIsaretle();
  }

  @Post("tara")
  @Roller("muhasebe")
  async tara() {
    const tarama = await this.uretici.tara();
    const posta = await this.eposta.bekleyenleriGonder();
    return { ...tarama, eposta: posta };
  }

  @Patch(":id/ustlen")
  ustlen(@Param("id") id: string) {
    return this.service.ustlen(id);
  }

  @Patch(":id/aksiyon")
  aksiyon(@Param("id") id: string, @Body() govde: unknown) {
    return this.service.aksiyonAlindi(id, bildirimAksiyonSemasi.parse(govde).not);
  }

  @Patch(":id/yoksay")
  yoksay(@Param("id") id: string) {
    return this.service.yokSay(id);
  }
}
