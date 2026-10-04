import { PersonelErisimGuard } from "./personel-erisim.guard";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { izinBakiyeDuzeltSemasi, izinKararSemasi, izinRetSemasi, izinTalepOlusturSemasi, izinTuruOlusturSemasi, tatilGunuSemasi } from "./izin.semalar";
import { IzinService } from "./izin.service";

@Controller("personel/izinler")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class IzinController {
  constructor(private readonly service: IzinService) {}
  @Get("turler") turler() { return this.service.turleriListele(aktifBaglam().tenantId); }
  @Post("turler") turOlustur(@Body() body: unknown) { return this.service.turOlustur(aktifBaglam().tenantId, izinTuruOlusturSemasi.parse(body)); }
  @Get("tatiller") tatiller(@Query("yil") yil?: string) { return this.service.tatilleriListele(aktifBaglam().tenantId, yil ? Number(yil) : undefined); }
  @Post("tatiller") tatilKaydet(@Body() body: unknown) { return this.service.tatilKaydet(aktifBaglam().tenantId, tatilGunuSemasi.parse(body)); }
  @Delete("tatiller/:id") @HttpCode(204) tatilSil(@Param("id") id: string) { return this.service.tatilSil(aktifBaglam().tenantId, id); }
  @Get() listele(@Query("personelId") personelId?: string) { return this.service.talepleriListele(aktifBaglam().tenantId, personelId); }
  @Post() olustur(@Body() body: unknown) { const ctx = aktifBaglam(); return this.service.talepOlustur(ctx.tenantId, ctx.userId, izinTalepOlusturSemasi.parse(body)); }
  @Post(":id/onayla") onayla(@Param("id") id: string) { const ctx = aktifBaglam(); return this.service.onayla(ctx.tenantId, id, ctx.userId); }
  @Post(":id/reddet") reddet(@Param("id") id: string, @Body() body: unknown) { const ctx = aktifBaglam(); return this.service.reddet(ctx.tenantId, id, ctx.userId, izinRetSemasi.parse(body).neden); }
  @Post(":id/iptal") iptal(@Param("id") id: string, @Body() body: unknown) { const ctx = aktifBaglam(); const neden = izinKararSemasi.parse(body).neden ?? "Kullanıcı tarafından iptal edildi"; return this.service.iptal(ctx.tenantId, id, neden); }
  @Post("bakiye-hareketleri") bakiyeDuzelt(@Body() body: unknown) { return this.service.bakiyeDuzelt(aktifBaglam().tenantId, izinBakiyeDuzeltSemasi.parse(body)); }
  @Get("bakiyeler/:personelId") bakiyeler(@Param("personelId") personelId: string) { return this.service.bakiyeler(aktifBaglam().tenantId, personelId); }
}
