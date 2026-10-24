import { Controller, Get, Put, Post, Delete, Body, Param } from "@nestjs/common";
import { TenantAiService, TenantAiAyariGirdi } from "./tenant-ai.service";
import { Roller } from "../../auth/roller.decorator";
import { aktifBaglam } from "../../core/istek-baglami";
import { TenantAiYapilandirma } from "../saglayici/ai-provider.factory";
import { SaltOkumadaAcik } from "../../auth/public.decorator";

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

  @SaltOkumadaAcik()
  @Post("ayarlar/test-et")
  async baglantiTestEt(@Body() girdi: TenantAiYapilandirma) {
    const { tenantId } = aktifBaglam();
    return this.service.baglantiTestEt(tenantId, girdi);
  }

  /** AI-81: güçlü sağlayıcı ("Derin analiz"); saglayici null → kaldırır. */
  @Put("ayarlar/guclu")
  async gucluKaydet(@Body() girdi: { saglayici?: string | null; apiKey?: string | null; modelAdi?: string | null; baseUrl?: string | null; girisTokenMilyonUsd?: number | null; cikisTokenMilyonUsd?: number | null }) {
    const { tenantId } = aktifBaglam();
    return this.service.gucluKaydet(tenantId, girdi ?? {});
  }

  @SaltOkumadaAcik()
  @Post("ayarlar/guclu/test-et")
  async gucluTestEt() {
    const { tenantId } = aktifBaglam();
    return this.service.gucluTestEt(tenantId);
  }

  @Post("ayarlar/guclu/onay")
  async gucluOnay(@Body() govde: { onay?: unknown; politikaSurumu?: unknown }) {
    const { tenantId } = aktifBaglam();
    return this.service.gucluOnay(tenantId, govde?.onay === true, typeof govde?.politikaSurumu === "string" ? govde.politikaSurumu : undefined);
  }

  /** AI-14: yurt dışı aktarım onayı ver / geri al. */
  @Post("ayarlar/yurt-disi-onay")
  async yurtDisiOnay(@Body() govde: { onay?: unknown; politikaSurumu?: unknown }) {
    const { tenantId } = aktifBaglam();
    return this.service.yurtDisiOnay(tenantId, govde?.onay === true, typeof govde?.politikaSurumu === "string" ? govde.politikaSurumu : undefined);
  }

  /** AI-15: son 30 günün kullanım sayacı. */
  @Get("kullanim")
  async kullanim() {
    const { tenantId } = aktifBaglam();
    return this.service.kullanim(tenantId);
  }

  @Get("kalite")
  kalite() {
    return this.service.kalite(aktifBaglam().tenantId);
  }

  @Get("gorevler")
  async gorevleriListele() {
    const { tenantId } = aktifBaglam();
    return this.service.gorevleriListele(tenantId);
  }

  @Post("gorevler")
  async gorevOlustur(@Body() girdi: unknown) {
    const { tenantId } = aktifBaglam();
    return this.service.gorevOlustur(tenantId, girdi);
  }

  @Put("gorevler/:id")
  async gorevGuncelle(@Param("id") id: string, @Body() girdi: unknown) {
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
