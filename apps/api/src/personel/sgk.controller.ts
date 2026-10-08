import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PersonelErisimGuard } from "./personel-erisim.guard";
import { SgkService, type DosyaBicimi } from "./sgk.service";

const BICIMLER: DosyaBicimi[] = ["xlsx", "pdf", "xml"];
const bicimAl = (bicim: string) => {
  if (!BICIMLER.includes(bicim as DosyaBicimi)) throw new BadRequestException("Biçim xlsx, pdf ya da xml olmalıdır");
  return bicim as DosyaBicimi;
};
const gonder = (res: Response, d: { buffer: Buffer; dosyaAdi: string; mime: string }) => {
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${d.dosyaAdi}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(d.buffer);
};

/** PRS-24…28 (P3-3): SGK bildirge verisi, MUHSGK ön dökümü ve yükleme XML'leri. */
@Controller("personel/sgk")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class SgkController {
  constructor(private readonly servis: SgkService) {}

  @Get("bildirgeler")
  bildirgeler(@Query() q: Record<string, string>) {
    return this.servis.bildirgeListesi(aktifBaglam().tenantId, q);
  }

  @Get("bildirgeler/dosya/:bicim")
  async bildirgeDosyasi(@Param("bicim") bicim: string, @Query() q: Record<string, string>, @Res() res: Response) {
    const { tenantId, userId } = aktifBaglam();
    gonder(res, await this.servis.bildirgeDosyasi(tenantId, userId, q, bicimAl(bicim)));
  }

  @Put("istihdam/:id/bildirge")
  isaretle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    return this.servis.bildirgeIsaretle(tenantId, userId, id, govde);
  }

  @Delete("istihdam/:id/bildirge/:tur")
  geriAl(@Param("id", ParseUUIDPipe) id: string, @Param("tur") tur: string) {
    if (tur !== "giris" && tur !== "cikis") throw new BadRequestException("Bildirge türü giris ya da cikis olmalıdır");
    const { tenantId, userId } = aktifBaglam();
    return this.servis.bildirgeIsaretGeriAl(tenantId, userId, id, tur);
  }

  @Put("istihdam/:id/cikis-kodu")
  cikisKodu(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    return this.servis.cikisKoduGuncelle(tenantId, userId, id, govde);
  }

  @Get("muhsgk")
  muhsgk(@Query() q: Record<string, string>) {
    return this.servis.muhsgk(aktifBaglam().tenantId, q);
  }

  @Get("muhsgk/dosya/:bicim")
  async muhsgkDosyasi(@Param("bicim") bicim: string, @Query() q: Record<string, string>, @Res() res: Response) {
    const { tenantId, userId } = aktifBaglam();
    gonder(res, await this.servis.muhsgkDosyasi(tenantId, userId, q, bicimAl(bicim)));
  }
}
