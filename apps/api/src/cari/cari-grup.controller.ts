import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from "@nestjs/common";
import { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { CariGrupService } from "./cari-grup.service";
import { cariGrupSemasi } from "./cari-grup";

function girdi(govde: unknown) {
  const sonuc = cariGrupSemasi.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
}

/** CARI-41: cari grupları (holding / ana firma) ve grup riski. */
@Controller("cari/gruplar")
export class CariGrupController {
  constructor(private readonly servis: CariGrupService) {}

  @Get()
  listele() {
    return this.servis.listele();
  }

  @Get(":id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.servis.getir(id);
  }

  @Get(":id/excel")
  async excel(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const { dosyaAdi, buffer } = await this.servis.excel(id);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${dosyaAdi}`);
    res.send(buffer);
  }

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) {
    return this.servis.olustur(girdi(govde));
  }

  @Patch(":id")
  @Roller("muhasebe")
  guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.servis.guncelle(id, girdi(govde));
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id", ParseUUIDPipe) id: string) {
    await this.servis.sil(id);
  }
}
