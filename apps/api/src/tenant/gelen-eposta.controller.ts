import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";
import { ImapService } from "./imap.service";

@Controller("eposta/gelen")
@Roller("yonetici", "muhasebe", "satis")
export class GelenEpostaController {
  constructor(private readonly imapService: ImapService) {}

  /**
   * Gelen e-postaları filtreli ve sayfalı listeler.
   */
  @Get()
  async listele(
    @Query("sayfa") sayfa?: string,
    @Query("adet") adet?: string,
    @Query("okundu") okundu?: string,
    @Query("durum") durum?: string,
    @Query("cariId") cariId?: string,
    @Query("arama") arama?: string,
  ) {
    const { tenantId } = aktifBaglam();
    return this.imapService.listele(tenantId, {
      sayfa: sayfa ? Number(sayfa) : 1,
      adet: adet ? Number(adet) : 25,
      okundu: okundu !== undefined ? okundu === "true" : undefined,
      durum: durum || undefined,
      cariId: cariId || undefined,
      arama: arama || undefined,
    });
  }

  /**
   * IMAP sunucusuyla senkronizasyonu manuel tetikler.
   */
  @Post("senkronize-et")
  async senkronizeEt() {
    const { tenantId } = aktifBaglam();
    return this.imapService.senkronizeEt(tenantId);
  }

  /**
   * E-posta detayını getirir.
   */
  /** AI-47: göndericinin olası carileri (gerekçeleriyle); cari bağlanmaz, kullanıcı seçer. */
  @Get(":id/cari-adaylari")
  async cariAdaylari(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.imapService.cariAdaylariGetir(tenantId, id);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.imapService.getir(tenantId, id);
  }

  /**
   * Okundu / okunmadı durumunu günceller.
   */
  @Patch(":id/okundu")
  async okunduGuncelle(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const sema = z.object({ okundu: z.boolean() });
    const parsed = sema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("okundu alanı zorunludur (boolean)");
    return this.imapService.okunduGuncelle(tenantId, id, parsed.data.okundu);
  }

  /**
   * E-posta işlem durumunu günceller (yeni, islendi, arsivlendi).
   */
  @Patch(":id/durum")
  async durumGuncelle(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const sema = z.object({ durum: z.enum(["yeni", "islendi", "arsivlendi"]) });
    const parsed = sema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Geçerli bir durum girin (yeni, islendi, arsivlendi)");
    return this.imapService.durumGuncelle(tenantId, id, parsed.data.durum);
  }

  /**
   * Ek dosyayı indirir.
   */
  @Get(":id/ekler/:ekId/indir")
  async ekIndir(
    @Param("id") id: string,
    @Param("ekId") ekId: string,
    @Res() res: Response,
  ) {
    const { tenantId } = aktifBaglam();
    const { tampon, dosyaAdi, mimeTuru } = await this.imapService.ekIndir(tenantId, id, ekId);
    res.setHeader("Content-Type", mimeTuru);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(dosyaAdi)}"`,
    );
    res.send(tampon);
  }

  /**
   * 1. İşlev: E-postadan CRM Görevi / Fırsatı açar.
   */
  @Post(":id/crm-gorev")
  async crmGorevOlustur(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const sema = z.object({ sorumluUserId: z.string().uuid().optional(), cariId: z.string().uuid().optional() });
    const parsed = sema.safeParse(body || {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((s) => s.message).join("; "));
    return this.imapService.crmGorevOlustur(tenantId, id, parsed.data.sorumluUserId ?? userId, parsed.data.cariId);
  }

  /**
   * 2. İşlev: Ek dosyadaki faturayı/fişi OCR ile tarar ve çıkarılan veriyi döner.
   */
  @Post(":id/ekler/:ekId/ocr")
  @Roller("yonetici", "muhasebe")
  async ekOcrCikar(@Param("id") id: string, @Param("ekId") ekId: string) {
    const { tenantId } = aktifBaglam();
    return this.imapService.ekOcrCikar(tenantId, id, ekId);
  }
}
