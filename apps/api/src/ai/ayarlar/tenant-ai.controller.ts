import { Controller, Get, Put, Post, Delete, Body, Param } from "@nestjs/common";
import { TenantAiService, TenantAiAyariGirdi, TenantAiGorevGirdi } from "./tenant-ai.service";
import { Roller } from "../../auth/roller.decorator";
import { aktifBaglam } from "../../core/istek-baglami";
import { TenantAiYapilandirma } from "../saglayici/ai-provider.factory";

@Controller("ai")
@Roller("yonetici")
export class TenantAiController {
  constructor(private readonly service: TenantAiService) {}

  @Get("ayarlar")
  async ayarGetir() {
    const { tenantId } = aktifBaglam();
    return this.service.ayarGetir(tenantId);
  }

  @Put("ayarlar")
  async ayarKaydet(@Body() girdi: TenantAiAyariGirdi) {
    const { tenantId } = aktifBaglam();
    return this.service.ayarKaydet(tenantId, girdi);
  }

  @Post("ayarlar/test-et")
  async baglantiTestEt(@Body() girdi: TenantAiYapilandirma) {
    const { tenantId } = aktifBaglam();
    return this.service.baglantiTestEt(tenantId, girdi);
  }

  @Get("gorevler")
  async gorevleriListele() {
    const { tenantId } = aktifBaglam();
    return this.service.gorevleriListele(tenantId);
  }

  @Post("gorevler")
  async gorevOlustur(@Body() girdi: TenantAiGorevGirdi) {
    const { tenantId } = aktifBaglam();
    return this.service.gorevOlustur(tenantId, girdi);
  }

  @Put("gorevler/:id")
  async gorevGuncelle(@Param("id") id: string, @Body() girdi: Partial<TenantAiGorevGirdi>) {
    const { tenantId } = aktifBaglam();
    return this.service.gorevGuncelle(tenantId, id, girdi);
  }

  @Delete("gorevler/:id")
  async gorevSil(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.service.gorevSil(tenantId, id);
  }

  @Post("gorevler/:id/calistir")
  async gorevCalistir(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.service.gorevCalistir(tenantId, id);
  }
}
