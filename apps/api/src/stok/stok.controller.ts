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
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Prisma } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { StokService } from "./stok.service";
import {
  kategoriSemasi,
  sayimOlusturSemasi,
  stokBirimSemasi,
  stokHareketOlusturSemasi,
  stokKartGuncelleSemasi,
  stokKartOlusturSemasi,
} from "./stok.semalar";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

@Controller("stok")
export class StokController {
  constructor(
    private readonly stokService: StokService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── KATEGORİ UÇLARI (Önce tanımlanmalı) ──────────────────────────────────

  @Get("kategoriler")
  async kategoriListele() {
    return this.stokService.kategoriListele();
  }

  @Post("kategoriler")
  @Roller("muhasebe")
  async kategoriOlustur(@Body() govde: unknown) {
    const ayristirma = kategoriSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.kategoriOlustur(ayristirma.data);
  }

  @Delete("kategoriler/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async kategoriSil(@Param("id") id: string) {
    await this.stokService.kategoriSil(id);
  }

  // Envanter raporu RPR-06 araç setine taşındı: stok.envanter (STK-13).

  // ─── SAYIM UÇLARI ────────────────────────────────────────────────────────

  @Get("sayimlar")
  async sayimListesi() {
    return this.stokService.sayimListesi();
  }

  @Get("sayimlar/:id")
  async sayimGetir(@Param("id") id: string) {
    return this.stokService.sayimGetir(id);
  }

  @Post("sayimlar")
  @Roller("muhasebe")
  async sayimOlustur(@Body() govde: unknown) {
    const ayristirma = sayimOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.sayimOlustur(ayristirma.data);
  }

  // ─── STOK KART UÇLARI ────────────────────────────────────────────────────

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("kategoriId") kategoriId?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
  ) {
    const adetSayi = adet ? parseInt(adet, 10) : undefined;
    return this.stokService.listele(arama, kategoriId, imlec, adetSayi);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.stokService.getir(id);
  }

  @Post()
  @Roller("muhasebe")
  async olustur(@Body() govde: unknown) {
    const ayristirma = stokKartOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.olustur(ayristirma.data);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = stokKartGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.guncelle(id, ayristirma.data);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.stokService.sil(id);
  }

  // ─── ÇOKLU BİRİM UÇLARI ──────────────────────────────────────────────────

  @Post(":id/birimler")
  @Roller("muhasebe")
  async birimEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = stokBirimSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.birimEkle(id, ayristirma.data);
  }

  @Delete(":id/birimler/:birimId")
  @Roller("muhasebe")
  @HttpCode(204)
  async birimSil(
    @Param("id") id: string,
    @Param("birimId") birimId: string,
  ) {
    await this.stokService.birimSil(id, birimId);
  }

  // ─── STOK HAREKET UÇLARI ─────────────────────────────────────────────────

  @Get(":id/hareketler")
  async hareketListele(@Param("id") id: string) {
    return this.stokService.hareketListele(id);
  }

  @Post(":id/hareketler")
  @Roller("muhasebe")
  async hareketEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = stokHareketOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    const girdi = ayristirma.data;
    if (girdi.stokId !== id) {
      throw new BadRequestException("Uyuşmayan stok kartı ID'si");
    }

    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, (tx) =>
      this.stokService.hareketEkle(
        tx,
        id,
        girdi.tip,
        D(girdi.miktar),
        girdi.girilenBirim,
        D(girdi.girilenMiktar),
        D(girdi.maliyet),
        new Date(girdi.tarih),
        girdi.aciklama,
      ),
    );
  }

  @Post("excel-aktar")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file"))
  async excelAktar(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    return this.stokService.excelImport(file.buffer);
  }
}
