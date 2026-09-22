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
import { Response } from "express";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { BelgelerService } from "./belgeler.service";
import {
  belgeDonusturSemasi,
  belgeGuncelleSemasi,
  belgeOlusturSemasi,
  tasimaBilgisiSemasi,
  topluFaturaSemasi,
} from "./belgeler.semalar";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) {
    throw new BadRequestException(
      sonuc.error.issues.map((s) => s.message).join("; "),
    );
  }
  return sonuc.data;
}

@Controller("belgeler")
export class BelgelerController {
  constructor(private readonly belgelerService: BelgelerService) {}

  @Get()
  async listele(
    @Query("tur") tur?: string,
    @Query("yon") yon?: string,
    @Query("durum") durum?: string,
    @Query("arama") arama?: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("imlec") imlec?: string,
  ) {
    return this.belgelerService.listele(tur, yon, durum, arama, baslangic, bitis, imlec);
  }

  @Get("sevkiyat-bekleyen-faturalar")
  async sevkiyatBekleyenFaturalar(@Query("cariId") cariId?: string) {
    return this.belgelerService.sevkiyatBekleyenFaturalar(cariId);
  }

  /** EBLG-35: e-İrsaliye ve bağlı fatura durum geçmişi. */
  @Get(":id/durum-gecmisi")
  async durumGecmisi(@Param("id") id: string) {
    return this.belgelerService.durumGecmisi(id);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.belgelerService.getir(id);
  }

  @Post()
  @Roller("muhasebe", "satis")
  async olustur(@Body() govde: unknown) {
    return this.belgelerService.olustur(ayristir(belgeOlusturSemasi, govde));
  }

  /** Onaylanmış irsaliyede de açık kalan tek alan kümesi (EBLG-23). */
  @Patch(":id/tasima-bilgisi")
  @Roller("muhasebe", "satis")
  async tasimaBilgisi(@Param("id") id: string, @Body() govde: unknown) {
    return this.belgelerService.tasimaBilgisiGuncelle(id, ayristir(tasimaBilgisiSemasi, govde));
  }

  @Patch(":id")
  @Roller("muhasebe", "satis")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    return this.belgelerService.guncelle(
      id,
      ayristir(belgeGuncelleSemasi, govde),
    );
  }

  @Delete(":id")
  @Roller("muhasebe", "satis")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.belgelerService.sil(id);
  }

  @Post(":id/kopyala")
  @Roller("muhasebe", "satis")
  async kopyala(@Param("id") id: string) {
    return this.belgelerService.kopyala(id);
  }

  @Post(":id/onayla")
  @Roller("muhasebe", "satis")
  async onayla(@Param("id") id: string) {
    return this.belgelerService.onayla(id);
  }

  @Post(":id/iptal")
  @Roller("muhasebe", "satis")
  async iptal(@Param("id") id: string) {
    return this.belgelerService.iptal(id);
  }

  @Post(":id/donustur")
  @Roller("muhasebe", "satis")
  async donustur(@Param("id") id: string, @Body() govde: unknown) {
    const { hedef, kalemler } = ayristir(belgeDonusturSemasi, govde);
    return this.belgelerService.donustur(id, hedef, { kalemler });
  }

  /** FTR-13: bekleyen sipariş/irsaliyeleri tek fatura taslağında birleştirir. */
  @Post("toplu-fatura")
  @Roller("muhasebe")
  async topluFatura(@Body() govde: unknown) {
    return this.belgelerService.topluFatura(ayristir(topluFaturaSemasi, govde));
  }

  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @Res() res: Response) {
    const pdf = await this.belgelerService.pdfUret(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }
}
