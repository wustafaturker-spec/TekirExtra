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
  bankaHesapSemasi,
  etiketSemasi,
  kisiSemasi,
  cariHareketSemasi,
  crmEtkilesimSemasi,
  crmGorevDurumSemasi,
  crmGorevSemasi,
  ekstreEpostaSemasi,
} from "./cari.semalar";
import { sayfaAdedi } from "../core/sayfalama";
import { AbonelikService } from "../tenant/abonelik.service";

@Controller("cari")
export class CariController {
  constructor(private readonly cariService: CariService, private readonly abonelik: AbonelikService) {}

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
    @Query("tip") tip?: string,
    @Query("durum") durum?: string,
    @Query("bakiye") bakiye?: string,
  ) {
    const adetSayi = sayfaAdedi(adet);
    return this.cariService.listele(arama, imlec, adetSayi, tip, durum, bakiye);
  }

  @Get("etiketler")
  async etiketleriListele() {
    return this.cariService.etiketleriListele();
  }

  @Post("etiketler")
  @Roller("muhasebe")
  async etiketOlustur(@Body() govde: unknown) {
    const ayristirma = etiketSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.etiketOlustur(ayristirma.data);
  }

  @Delete("etiketler/:etiketId")
  @Roller("muhasebe")
  @HttpCode(204)
  async etiketSil(@Param("etiketId") etiketId: string) {
    await this.cariService.etiketSil(etiketId);
  }

  @Get("kur-farki-analizi")
  @Roller("muhasebe")
  async kurFarkiAnalizi(@Query("tarih") tarih?: string) {
    return this.cariService.kurFarkiAnalizi(tarih);
  }

  @Post("kur-farki-faturasi-olustur")
  @Roller("muhasebe")
  async kurFarkiFaturasiOlustur(@Body() body: { cariId: string; dovizCinsi: string; kurFarkiTutari: number; aciklama: string }) {
    return this.cariService.kurFarkiFaturasiOlustur(body.cariId, body.dovizCinsi, body.kurFarkiTutari, body.aciklama);
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
    await this.abonelik.limitDogrula("cari");
    return this.cariService.olustur(ayristirma.data);
  }

  @Post(":id/kopyala")
  @Roller("muhasebe", "satis")
  async kopyala(@Param("id") id: string) {
    return this.cariService.kopyala(id);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cariGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => `${s.path.join(".") || "alan"}: ${s.message}`).join("; "),
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

  @Patch(":id/adresler/:adresId")
  @Roller("muhasebe")
  async adresGuncelle(@Param("id") id: string, @Param("adresId") adresId: string, @Body() govde: unknown) {
    const ayristirma = adresSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((s) => s.message).join("; "));
    return this.cariService.adresGuncelle(id, adresId, ayristirma.data);
  }

  @Delete(":id/adresler/:adresId")
  @Roller("muhasebe")
  @HttpCode(204)
  async adresSil(@Param("id") id: string, @Param("adresId") adresId: string) {
    await this.cariService.adresSil(id, adresId);
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

  @Delete(":id/kisiler/:kisiId")
  @Roller("muhasebe")
  @HttpCode(204)
  async kisiSil(@Param("id") id: string, @Param("kisiId") kisiId: string) {
    await this.cariService.kisiSil(id, kisiId);
  }

  @Post(":id/banka-hesaplari")
  @Roller("muhasebe")
  async bankaHesapEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = bankaHesapSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.cariService.bankaHesapEkle(id, ayristirma.data);
  }

  @Delete(":id/banka-hesaplari/:hesapId")
  @Roller("muhasebe")
  @HttpCode(204)
  async bankaHesapSil(
    @Param("id") id: string,
    @Param("hesapId") hesapId: string,
  ) {
    await this.cariService.bankaHesapSil(id, hesapId);
  }

  @Post(":id/etiketler/:etiketId")
  @Roller("muhasebe")
  async etiketAta(
    @Param("id") id: string,
    @Param("etiketId") etiketId: string,
  ) {
    return this.cariService.etiketAta(id, etiketId);
  }

  @Delete(":id/etiketler/:etiketId")
  @Roller("muhasebe")
  @HttpCode(204)
  async etiketKaldir(
    @Param("id") id: string,
    @Param("etiketId") etiketId: string,
  ) {
    await this.cariService.etiketKaldir(id, etiketId);
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

  @Get(":id/crm")
  async crmGetir(@Param("id") id: string) { return this.cariService.crmGetir(id); }

  @Get(":id/davranis-analizi")
  async davranisAnalizi(@Param("id") id: string) { return this.cariService.davranisAnalizi(id); }

  @Post(":id/crm/etkilesimler")
  @Roller("muhasebe", "satis")
  async crmEtkilesimEkle(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = crmEtkilesimSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmEtkilesimEkle(id, sonuc.data);
  }

  @Post(":id/crm/gorevler")
  @Roller("muhasebe", "satis")
  async crmGorevEkle(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = crmGorevSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmGorevEkle(id, sonuc.data);
  }

  @Patch(":id/crm/gorevler/:gorevId")
  @Roller("muhasebe", "satis")
  async crmGorevDurum(@Param("id") id: string, @Param("gorevId") gorevId: string, @Body() govde: unknown) {
    const sonuc = crmGorevDurumSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.crmGorevDurum(id, gorevId, sonuc.data.durum);
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
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async excelAktar(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    return this.cariService.excelImport(file.buffer);
  }

  @Get(":id/ekstre/pdf")
  async ekstrePdf(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
  ) {
    const buffer = await this.cariService.ekstrePdf(id, baslangic, bitis);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ekstre-${id}.pdf`,
    );
    res.send(buffer);
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

  @Post(":id/ekstre/eposta")
  @Roller("muhasebe", "satis")
  async ekstreEposta(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = ekstreEpostaSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.cariService.ekstreEpostaGonder(id, sonuc.data.baslangic, sonuc.data.bitis, sonuc.data.alici);
  }
}
