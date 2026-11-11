import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { OnayService } from "./onay.service";

const kimlik = (id: string) => { if (!z.uuid().safeParse(id).success) throw new BadRequestException("Geçersiz kayıt"); return id; };

/**
 * ONY-06: tek onay kutusu. Her oturum açmış kullanıcı kendi kutusunu görür; karar yetkisi
 * talebin adımında denetlenir (rol ya da kişi, görev ayrılığı).
 */
@Controller("onaylar")
export class OnayController {
  constructor(private readonly onay: OnayService) {}

  @Get()
  liste(@Query("kutu") kutu?: string) {
    const k = kutu === "taleplerim" || kutu === "gecmis" ? kutu : "bekleyen";
    return this.onay.liste(k);
  }

  @Get(":id")
  getir(@Param("id") id: string) {
    return this.onay.getir(kimlik(id));
  }

  @Post(":id/onayla")
  @HttpCode(200)
  onayla(@Param("id") id: string, @Body() govde: { gerekce?: unknown }) {
    return this.onay.karar(kimlik(id), "onay", typeof govde?.gerekce === "string" ? govde.gerekce.slice(0, 500) : null);
  }

  @Post(":id/reddet")
  @HttpCode(200)
  reddet(@Param("id") id: string, @Body() govde: { gerekce?: unknown }) {
    return this.onay.karar(kimlik(id), "ret", typeof govde?.gerekce === "string" ? govde.gerekce.slice(0, 500) : null);
  }

  @Post(":id/geri-cek")
  @HttpCode(200)
  geriCek(@Param("id") id: string) {
    return this.onay.geriCek(kimlik(id));
  }
}

/** ONY-01/04/08: onay kuralları yalnız yönetici tarafından düzenlenir. */
@Controller("onay-kurallari")
@Roller("yonetici")
export class OnayKuraliController {
  constructor(private readonly onay: OnayService) {}

  @Get()
  liste() {
    return this.onay.kurallar();
  }

  @Post()
  ekle(@Body() govde: unknown) {
    return this.onay.kuralKaydet(null, govde);
  }

  @Put("satin-alma-esigi")
  satinAlmaEsigi(@Body() govde: { tutar?: unknown }) {
    return this.onay.satinAlmaEsigiKaydet(Number(govde?.tutar));
  }

  @Put("gorev-ayriligi")
  gorevAyriligi(@Body() govde: { kapali?: unknown }) {
    return this.onay.gorevAyriligiKaydet(govde?.kapali === true);
  }

  @Put(":id")
  guncelle(@Param("id") id: string, @Body() govde: unknown) {
    return this.onay.kuralKaydet(kimlik(id), govde);
  }

  @Delete(":id")
  sil(@Param("id") id: string) {
    return this.onay.kuralSil(kimlik(id));
  }
}
