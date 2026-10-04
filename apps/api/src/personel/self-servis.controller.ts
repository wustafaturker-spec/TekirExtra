import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PersonelErisimGuard } from "./personel-erisim.guard";
import { SelfServisService } from "./self-servis.service";

/** PRS-21: çalışanın kendi verisi; yalnız `calisan` rolü (yönetici geçer ama bağlı kartı yoksa reddedilir). */
@Controller("self-servis")
@Roller("calisan")
export class SelfServisController {
  constructor(private readonly servis: SelfServisService) {}

  @Get("ben")
  ben() { const { tenantId, userId } = aktifBaglam(); return this.servis.ben(tenantId, userId); }

  @Get("pusulalar")
  pusulalar() { const { tenantId, userId } = aktifBaglam(); return this.servis.pusulalar(tenantId, userId); }

  @Get("pusulalar/:id/pdf")
  async pusulaPdf(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const { tenantId, userId } = aktifBaglam();
    const { buffer, dosyaAdi } = await this.servis.pusulaPdf(tenantId, userId, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${dosyaAdi}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  }

  @Get("izinler")
  izinler() { const { tenantId, userId } = aktifBaglam(); return this.servis.izinler(tenantId, userId); }

  @Post("izinler")
  izinTalebi(@Body() govde: unknown) { const { tenantId, userId } = aktifBaglam(); return this.servis.izinTalebi(tenantId, userId, govde); }

  @Post("izinler/:id/geri-cek")
  izinGeriCek(@Param("id", ParseUUIDPipe) id: string) { const { tenantId, userId } = aktifBaglam(); return this.servis.izinGeriCek(tenantId, userId, id); }

  @Get("avanslar")
  avanslar() { const { tenantId, userId } = aktifBaglam(); return this.servis.avanslar(tenantId, userId); }

  @Post("avanslar")
  avansTalebi(@Body() govde: unknown) { const { tenantId, userId } = aktifBaglam(); return this.servis.avansTalebi(tenantId, userId, govde); }

  @Post("avanslar/:id/geri-cek")
  avansGeriCek(@Param("id", ParseUUIDPipe) id: string) { const { tenantId, userId } = aktifBaglam(); return this.servis.avansGeriCek(tenantId, userId, id); }

  @Get("bilgi-talepleri")
  bilgiTalepleri() { const { tenantId, userId } = aktifBaglam(); return this.servis.bilgiTalepleri(tenantId, userId); }

  @Post("bilgi-talepleri")
  bilgiTalebi(@Body() govde: unknown) { const { tenantId, userId } = aktifBaglam(); return this.servis.bilgiTalebi(tenantId, userId, govde); }

  @Post("bilgi-talepleri/:id/geri-cek")
  bilgiGeriCek(@Param("id", ParseUUIDPipe) id: string) { const { tenantId, userId } = aktifBaglam(); return this.servis.bilgiGeriCek(tenantId, userId, id); }
}

/** PRS-21: İK'nın personel kartındaki self-servis daveti ve erişim kapatma. */
@Controller("personel")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class SelfServisDavetController {
  constructor(private readonly servis: SelfServisService) {}

  /** PRS-22: çalışanların bilgi güncelleme talepleri (varsayılan bekleyenler). */
  @Get("bilgi-talepleri")
  bilgiTalepleri(@Query("durum") durum?: string, @Query("personelId") personelId?: string) {
    return this.servis.bilgiTalepleriIk(aktifBaglam().tenantId, durum && ["bekliyor", "onaylandi", "reddedildi", "iptal", "hepsi"].includes(durum) ? durum : "bekliyor", personelId && /^[0-9a-f-]{36}$/i.test(personelId) ? personelId : undefined);
  }

  @Post("bilgi-talepleri/:talepId/onayla")
  bilgiOnayla(@Param("talepId", ParseUUIDPipe) talepId: string) { const { tenantId, userId } = aktifBaglam(); return this.servis.bilgiOnayla(tenantId, talepId, userId); }

  @Post("bilgi-talepleri/:talepId/reddet")
  bilgiReddet(@Param("talepId", ParseUUIDPipe) talepId: string, @Body() govde: unknown) { const { tenantId, userId } = aktifBaglam(); return this.servis.bilgiReddet(tenantId, talepId, userId, govde); }

  @Get(":id/self-servis")
  durum(@Param("id", ParseUUIDPipe) id: string) { return this.servis.durum(aktifBaglam().tenantId, id); }

  @Post(":id/self-servis/davet")
  davet(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { const { tenantId, userId } = aktifBaglam(); return this.servis.davetEt(tenantId, id, userId, govde); }

  @Post(":id/self-servis/kapat")
  kapat(@Param("id", ParseUUIDPipe) id: string) { const { tenantId, userId } = aktifBaglam(); return this.servis.erisimKapat(tenantId, id, userId); }
}

/** PRS-21: davet bağlantısı; girişsiz, yalnız 256 bitlik anahtarla. */
@Controller("self-servis-davet")
@Public()
export class SelfServisDavetPortalController {
  constructor(private readonly servis: SelfServisService) {}

  @Get(":tenantId/:anahtar")
  @Header("Cache-Control", "private, no-store")
  goruntule(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("anahtar") anahtar: string) { return this.servis.davetGoruntule(tenantId, anahtar); }

  @Post(":tenantId/:anahtar")
  parolaBelirle(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("anahtar") anahtar: string, @Body() govde: unknown) { return this.servis.parolaBelirle(tenantId, anahtar, govde); }
}
