import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { donemKilidiAcSemasi, isMerkeziKaydetSemasi, kaliteKararSemasi, operasyonBaslatSemasi, operasyonBekletSemasi, operasyonTamamlaSemasi, receteKapsamSemasi, receteKaydetSemasi, sarfDuzeltmeSemasi, uretimBildirimiSemasi, uretimDonemKilidiSemasi, uretimEmriListeSemasi, uretimEmriKapatSemasi, uretimEmriOlusturSemasi, vardiyaKaydetSemasi, yenidenIslemeTamamlaSemasi } from "./uretim.semalar";
import { UretimService } from "./uretim.service";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

@Controller("uretim")
@Roller("muhasebe", "salt_okunur", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi")
export class UretimController {
  constructor(private readonly service: UretimService) {}

  @Get("ozet") ozet() { return this.service.ozet(); }
  @Get("is-merkezleri") isMerkezleri() { return this.service.isMerkezleri(); }
  @Get("vardiyalar") vardiyalar() { return this.service.vardiyalar(); }
  @Post("vardiyalar") @Roller("uretim_planlama") vardiyaOlustur(@Body() govde: unknown) { return this.service.vardiyaOlustur(ayristir(vardiyaKaydetSemasi, govde)); }
  @Get("operatorler") operatorler() { return this.service.operatorler(); }
  @Get("satis-siparisleri") satisSiparisleri() { return this.service.uretimBekleyenSatisSiparisleri(); }
  @Get("terminal/barkod/:barkod") terminalBarkod(@Param("barkod") barkod: string) { return this.service.terminalBarkod(barkod); }
  @Get("donem-kilitleri") donemKilitleri() { return this.service.donemKilitleri(); }
  @Post("donem-kilitleri") @Roller("maliyet_muhasebesi") donemKilitle(@Body() govde: unknown) { return this.service.donemKilitle(ayristir(uretimDonemKilidiSemasi, govde)); }
  @Delete("donem-kilitleri/:id") @Roller("maliyet_muhasebesi") @HttpCode(204) async donemKilidiAc(@Param("id") id: string, @Body() govde: unknown) { await this.service.donemKilidiAc(id, ayristir(donemKilidiAcSemasi, govde ?? {}).neden); }
  @Post("is-merkezleri") @Roller("uretim_planlama", "maliyet_muhasebesi") isMerkeziOlustur(@Body() govde: unknown) { return this.service.isMerkeziOlustur(ayristir(isMerkeziKaydetSemasi, govde)); }
  @Put("is-merkezleri/:id") @Roller("uretim_planlama", "maliyet_muhasebesi") isMerkeziGuncelle(@Param("id") id: string, @Body() govde: unknown) { return this.service.isMerkeziGuncelle(id, ayristir(isMerkeziKaydetSemasi, govde)); }
  @Get("kapasite") kapasite(@Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) { return this.service.kapasite(baslangic, bitis); }
  @Get("maliyet-raporu") @Roller("muhasebe", "salt_okunur", "uretim_planlama", "maliyet_muhasebesi") maliyetRaporu(@Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) { return this.service.maliyetRaporu(baslangic, bitis); }
  @Get("kalite-kontrolleri") kaliteKontrolleri(@Query("durum") durum?: string) { return this.service.kaliteKontrolleri(durum); }
  @Post("kalite-kontrolleri/:id/karar") @Roller("kalite") kaliteKarari(@Param("id") id: string, @Body() govde: unknown) { return this.service.kaliteKarari(id, ayristir(kaliteKararSemasi, govde)); }
  @Post("kalite-kontrolleri/:id/yeniden-isleme-tamamla") @Roller("uretim_operatoru") yenidenIslemeTamamla(@Param("id") id: string, @Body() govde: unknown) { return this.service.yenidenIslemeTamamla(id, ayristir(yenidenIslemeTamamlaSemasi, govde)); }

  @Get("urunler") urunler() { return this.service.uretilebilirUrunler(); }
  @Get("receteler/:stokId") recete(@Param("stokId") stokId: string, @Query() sorgu: unknown) { return this.service.receteGetir(stokId, ayristir(receteKapsamSemasi, sorgu).varyantId ?? null); }
  @Get("receteler/:stokId/ozel-varyantlar") ozelReceteliVaryantlar(@Param("stokId") stokId: string) { return this.service.ozelReceteliVaryantlar(stokId); }
  @Get("receteler/:stokId/surumler") receteSurumleri(@Param("stokId") stokId: string) { return this.service.receteSurumleri(stokId); }
  @Post("receteler/:stokId") @Roller("uretim_planlama") receteKaydet(@Param("stokId") stokId: string, @Body() govde: unknown) { return this.service.receteKaydet(stokId, ayristir(receteKaydetSemasi, govde)); }
  @Delete("receteler/:stokId") @Roller("uretim_planlama") @HttpCode(204) async receteSil(@Param("stokId") stokId: string, @Query() sorgu: unknown) { await this.service.receteSil(stokId, ayristir(receteKapsamSemasi, sorgu).varyantId ?? null); }
  @Post("receteler/:stokId/surumler/:surumId/onayla") @Roller("uretim_planlama") receteOnayla(@Param("stokId") stokId: string, @Param("surumId") surumId: string) { return this.service.receteOnayla(stokId, surumId); }

  @Get("emirler") emirler(@Query() sorgu: unknown) { return this.service.emirleriListele(ayristir(uretimEmriListeSemasi, sorgu)); }
  @Get("emirler/:id") emir(@Param("id") id: string) { return this.service.emirGetir(id); }
  @Get("emirler/:id/malzeme-uygunlugu") malzemeUygunlugu(@Param("id") id: string) { return this.service.malzemeUygunlugu(id); }
  @Get("emirler/:id/maliyet") maliyet(@Param("id") id: string) { return this.service.maliyet(id); }
  @Post("emirler") @Roller("uretim_planlama") emirOlustur(@Body() govde: unknown) { return this.service.emirOlustur(ayristir(uretimEmriOlusturSemasi, govde)); }
  @Post("emirler/:id/planla") @Roller("uretim_planlama") planla(@Param("id") id: string) { return this.service.planla(id); }
  @Post("emirler/:id/rezerve-et") @Roller("depo") rezerveEt(@Param("id") id: string) { return this.service.rezerveEt(id); }
  @Post("emirler/:id/baslat") @Roller("uretim_planlama", "uretim_operatoru") baslat(@Param("id") id: string) { return this.service.baslat(id); }
  @Post("emirler/:id/operasyonlar/:operasyonId/baslat") @Roller("uretim_operatoru") operasyonBaslat(@Param("id") id: string, @Param("operasyonId") operasyonId: string, @Body() govde: unknown) { return this.service.operasyonBaslat(id, operasyonId, ayristir(operasyonBaslatSemasi, govde)); }
  @Post("emirler/:id/operasyonlar/:operasyonId/beklet") @Roller("uretim_operatoru") operasyonBeklet(@Param("id") id: string, @Param("operasyonId") operasyonId: string, @Body() govde: unknown) { return this.service.operasyonBeklet(id, operasyonId, ayristir(operasyonBekletSemasi, govde)); }
  @Post("emirler/:id/operasyonlar/:operasyonId/tamamla") @Roller("uretim_operatoru") operasyonTamamla(@Param("id") id: string, @Param("operasyonId") operasyonId: string, @Body() govde: unknown) { return this.service.operasyonTamamla(id, operasyonId, ayristir(operasyonTamamlaSemasi, govde)); }
  @Post("emirler/:id/bildirimler") @Roller("uretim_operatoru") bildir(@Param("id") id: string, @Body() govde: unknown) { return this.service.bildir(id, ayristir(uretimBildirimiSemasi, govde)); }
  @Post("emirler/:id/sarf-duzeltmeleri") @Roller("uretim_operatoru", "depo") sarfDuzelt(@Param("id") id: string, @Body() govde: unknown) { return this.service.sarfDuzelt(id, ayristir(sarfDuzeltmeSemasi, govde)); }
  @Post("emirler/:id/kapat") @Roller("uretim_planlama") kapat(@Param("id") id: string, @Body() govde: unknown) { return this.service.kapat(id, ayristir(uretimEmriKapatSemasi, govde)); }
  @Post("emirler/:id/iptal") @Roller("uretim_planlama") iptal(@Param("id") id: string) { return this.service.iptal(id); }
}
