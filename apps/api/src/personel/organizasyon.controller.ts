import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { departmanOlusturSemasi, isyeriOlusturSemasi, personelOrganizasyonAtaSemasi, pozisyonOlusturSemasi } from "./organizasyon.semalar";
import { OrganizasyonService } from "./organizasyon.service";
@Controller("personel/organizasyon") @Roller("muhasebe")
export class OrganizasyonController {
  constructor(private readonly service: OrganizasyonService) {}
  @Get() agac() { return this.service.agac(aktifBaglam().tenantId); }
  @Post("isyerleri") isyeri(@Body() b: unknown) { return this.service.isyeriOlustur(aktifBaglam().tenantId, isyeriOlusturSemasi.parse(b)); }
  @Post("departmanlar") departman(@Body() b: unknown) { return this.service.departmanOlustur(aktifBaglam().tenantId, departmanOlusturSemasi.parse(b)); }
  @Post("pozisyonlar") pozisyon(@Body() b: unknown) { return this.service.pozisyonOlustur(aktifBaglam().tenantId, pozisyonOlusturSemasi.parse(b)); }
  @Put("personeller/:id") ata(@Param("id") id: string, @Body() b: unknown) { return this.service.personelAta(aktifBaglam().tenantId, id, personelOrganizasyonAtaSemasi.parse(b)); }
}
