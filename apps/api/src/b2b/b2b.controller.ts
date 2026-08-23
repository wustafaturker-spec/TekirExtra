import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { B2bService } from "./b2b.service";
import { b2bSiparisOlusturSemasi } from "./b2b.semalar";
import { aktifBaglam } from "../core/istek-baglami";

@Controller("b2b")
export class B2bController {
  constructor(private readonly b2bService: B2bService) {}

  @Get("katalog/:cariId")
  async bayiKatalogGetir(@Param("cariId") cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.b2bService.bayiKatalogGetir(tenantId, cariId);
  }

  @Get("ekstre/:cariId")
  async bayiEkstreGetir(@Param("cariId") cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.b2bService.bayiEkstreGetir(tenantId, cariId);
  }

  @Post("siparis")
  async siparisOlustur(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = b2bSiparisOlusturSemasi.parse(body);
    return this.b2bService.siparisOlustur(tenantId, veri);
  }
}
