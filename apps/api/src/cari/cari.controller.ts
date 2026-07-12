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
  UseInterceptors,
  UploadedFile,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { CariService } from "./cari.service";
import {
  cariOlusturSemasi,
  cariGuncelleSemasi,
  adresSemasi,
  kisiSemasi,
  cariHareketSemasi,
} from "./cari.semalar";

@Controller("cari")
export class CariController {
  constructor(private readonly cariService: CariService) {}

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
  ) {
    const adetSayi = adet ? parseInt(adet, 10) : undefined;
    return this.cariService.listele(arama, imlec, adetSayi);
  }

  @Get("rapor/yaslandirma")
  async yaslandirmaRaporu() {
    return this.cariService.yaslandirmaRaporu();
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.cariService.getir(id);
  }

  @Post()
  @Roller("muhasebe")
  async olustur(@Body() govde: unknown) {
    const ayristirma = cariOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.olustur(ayristirma.data);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cariGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.guncelle(id, ayristirma.data);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.cariService.sil(id);
  }

  @Post(":id/adresler")
  @Roller("muhasebe")
  async adresEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = adresSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.adresEkle(id, ayristirma.data);
  }

  @Post(":id/kisiler")
  @Roller("muhasebe")
  async kisiEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kisiSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.kisiEkle(id, ayristirma.data);
  }

  @Post(":id/hareketler")
  @Roller("muhasebe")
  async hareketEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cariHareketSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.hareketEkle(id, ayristirma.data);
  }

  @Get(":id/ekstre")
  async ekstre(
    @Param("id") id: string,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
  ) {
    return this.cariService.ekstre(id, baslangic, bitis);
  }

  @Post("excel-aktar")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file"))
  async excelAktar(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    return this.cariService.excelImport(file.buffer);
  }

  @Get(":id/ekstre/excel")
  async ekstreExcel(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
  ) {
    const buffer = await this.cariService.ekstreExcel(id, baslangic, bitis);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ekstre-${id}.xlsx`,
    );
    res.send(buffer);
  }
}
