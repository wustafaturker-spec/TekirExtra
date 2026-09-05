import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { B2bService } from "./b2b.service";
import { b2bSiparisOlusturSemasi } from "./b2b.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";

@Controller("b2b")
@Roller("b2b_bayi", "muhasebe", "satis")
export class B2bController {
  constructor(private readonly b2bService: B2bService) {}

  @Get("profil")
  bayiProfilGetir(@Query("cariId") cariId?: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.b2bService.bayiProfilGetir(tenantId, userId, rol, cariId);
  }

  @Get("katalog")
  bayiKatalogGetir(@Query("cariId") cariId?: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.b2bService.bayiKatalogGetir(tenantId, userId, rol, cariId);
  }

  @Get("ekstre")
  bayiEkstreGetir(@Query("cariId") cariId?: string) {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.b2bService.bayiEkstreGetir(tenantId, userId, rol, cariId);
  }

  @Post("siparis")
  async siparisOlustur(@Body() body: unknown) {
    const { tenantId, userId, rol } = aktifBaglam();
    const veri = b2bSiparisOlusturSemasi.parse(body);
    return this.b2bService.siparisOlustur(tenantId, userId, rol, veri);
  }
}
