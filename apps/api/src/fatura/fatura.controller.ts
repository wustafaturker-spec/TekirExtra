import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { FaturaService } from "./fatura.service";
import {
  faturaGuncelleSemasi,
  faturaOlusturSemasi,
  faturaSeriSemasi,
} from "./fatura.semalar";

@Controller("fatura")
export class FaturaController {
  constructor(private readonly faturaService: FaturaService) {}

  // ─── FATURA SERİ UÇLARI ───────────────────────────────────────────────────

  @Get("seriler")
  async seriListele() {
    return this.faturaService.seriListele();
  }

  @Post("seriler")
  @Roller("yonetici")
  async seriEkle(@Body() govde: unknown) {
    const ayristirma = faturaSeriSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.faturaService.seriEkle(ayristirma.data);
  }

  // ─── FATURA BELGE UÇLARI ──────────────────────────────────────────────────

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("tip") tip?: string,
    @Query("durum") durum?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
  ) {
    const adetSayi = adet ? parseInt(adet, 10) : undefined;
    return this.faturaService.listele(arama, tip, durum, imlec, adetSayi);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.faturaService.getir(id);
  }

  @Post()
  @Roller("muhasebe")
  async olustur(@Body() govde: unknown) {
    const ayristirma = faturaOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.faturaService.olustur(ayristirma.data);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = faturaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.faturaService.guncelle(id, ayristirma.data);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.faturaService.sil(id);
  }

  @Post(":id/kesinlestir")
  @Roller("muhasebe")
  async kesinlestir(
    @Param("id") id: string,
    @Body() govde: { no?: string; seri?: string },
  ) {
    return this.faturaService.kesinlestir(id, govde);
  }

  @Get(":id/pdf")
  async pdfUret(@Param("id") id: string, @Res() res: Response) {
    const pdf = await this.faturaService.pdfUret(id);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.stream.toString());
  }
}
