import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { PlatformRolleri, PlatformUcu, SaltOkumadaAcik } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { sablonGirdiSemasi, IletiSablonService } from "./ileti-sablon.service";

/** ILT-09: firma yöneticisi belge ve cari şablonlarını değiştirir; sistem şablonları bu uçta görünmez. */
@Controller("ileti-sablonlari")
@Roller("yonetici")
export class IletiSablonController {
  constructor(private readonly servis: IletiSablonService) {}
  @Get() liste() { return this.servis.firmaListesi(); }
  @SaltOkumadaAcik() @Post(":tur/onizle") @HttpCode(200) onizle(@Param("tur") tur: string, @Body() govde: unknown) { return this.servis.firmaOnizle(tur, sablonGirdiSemasi.parse(govde)); }
  @Put(":tur") kaydet(@Param("tur") tur: string, @Body() govde: unknown) { return this.servis.firmaKaydet(tur, sablonGirdiSemasi.parse(govde)); }
  @Delete(":tur") sifirla(@Param("tur") tur: string) { return this.servis.firmaSifirla(tur); }
}

/** ILT-09: sistem şablonlarını yalnız platform yöneticisi değiştirir. */
@PlatformUcu()
@PlatformRolleri("yonetici")
@Controller("platform/ileti/sablonlar")
export class PlatformIletiSablonController {
  constructor(private readonly servis: IletiSablonService) {}
  @Get() liste() { return this.servis.platformListesi(); }
  @Post(":tur/onizle") @HttpCode(200) onizle(@Param("tur") tur: string, @Body() govde: unknown) { return this.servis.platformOnizle(tur, sablonGirdiSemasi.parse(govde)); }
  @Put(":tur") kaydet(@Param("tur") tur: string, @Body() govde: unknown) { return this.servis.platformKaydet(tur, sablonGirdiSemasi.parse(govde)); }
  @Delete(":tur") sifirla(@Param("tur") tur: string) { return this.servis.platformSifirla(tur); }
}
