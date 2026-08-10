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
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { sayfaAdedi } from "../core/sayfalama";
import { stokExcelSablonYaz } from "../core/excel-yardimci";
import { DepoService } from "./depo.service";
import { StokService } from "./stok.service";
import {
  etiketBasSemasi,
  kategoriSemasi,
  sayimOlusturSemasi,
  stokBarkodSemasi,
  stokBirimSemasi,
  stokHareketOlusturSemasi,
  stokKartGuncelleSemasi,
  stokKartOlusturSemasi,
  stokTedarikciSemasi,
  stokVaryantGuncelleSemasi,
  stokVaryantSemasi,
} from "./stok.semalar";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

@Controller("stok")
export class StokController {
  constructor(
    private readonly stokService: StokService,
    private readonly depoService: DepoService,
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

  @Post("sayimlar/:id/onayla")
  @Roller("muhasebe")
  async sayimOnayla(@Param("id") id: string) {
    return this.stokService.sayimOnayla(id);
  }

  // ─── BARKOD ARAMA (STK-15) ───────────────────────────────────────────────

  @Get("barkod/:barkod")
  async barkodlaBul(@Param("barkod") barkod: string) {
    return this.stokService.barkodlaBul(barkod);
  }

  // ─── BARKOD ETİKET BASIMI (STK-15 devamı, T-02) ──────────────────────────

  @Post("etiketler")
  async etiketBas(@Body() govde: unknown, @Res() res: Response) {
    const ayristirma = etiketBasSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    const buffer = await this.stokService.etiketPdf(ayristirma.data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="stok-etiketler.pdf"',
    );
    res.send(buffer);
  }

  // ─── STOK KART UÇLARI ────────────────────────────────────────────────────

  @Get("kritik-ozeti")
  async kritikOzeti() {
    return this.stokService.kritikOzeti();
  }

  @Get("excel-sablon")
  async excelSablon(@Res() res: Response) {
    const buffer = await stokExcelSablonYaz();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="stok-ice-aktarma-sablonu.xlsx"');
    res.send(buffer);
  }

  @Post("excel-onizle")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("file"))
  async excelOnizle(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException("Lütfen bir Excel dosyası yükleyin");
    return this.stokService.excelOnizle(file.buffer);
  }

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("kategoriId") kategoriId?: string,
    @Query("imlec") imlec?: string,
    @Query("adet") adet?: string,
  ) {
    const adetSayi = sayfaAdedi(adet);
    return this.stokService.listele(arama, kategoriId, imlec, adetSayi);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.stokService.getir(id);
  }

  @Get(":id/tavsiye-fiyat")
  async tavsiyeFiyat(
    @Param("id") id: string,
    @Query("cariId") cariId?: string,
    @Query("tip") tip = "satis",
  ) {
    return this.stokService.tavsiyeFiyat(id, cariId, tip);
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

  @Post(":id/kopyala")
  @Roller("muhasebe", "satis")
  async kopyala(@Param("id") id: string) {
    return this.stokService.kopyala(id);
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

  // ─── BARKOD UÇLARI (STK-15) ──────────────────────────────────────────────

  @Post(":id/barkodlar")
  @Roller("muhasebe")
  async barkodEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = stokBarkodSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.barkodEkle(id, ayristirma.data);
  }

  @Delete(":id/barkodlar/:barkodId")
  @Roller("muhasebe")
  @HttpCode(204)
  async barkodSil(
    @Param("id") id: string,
    @Param("barkodId") barkodId: string,
  ) {
    await this.stokService.barkodSil(id, barkodId);
  }

  // ─── TEDARİKÇİ UÇLARI (STK-18) ───────────────────────────────────────────

  @Post(":id/tedarikciler")
  @Roller("muhasebe")
  async tedarikciEkle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = stokTedarikciSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.stokService.tedarikciEkle(id, ayristirma.data);
  }

  @Delete(":id/tedarikciler/:tedarikciId")
  @Roller("muhasebe")
  @HttpCode(204)
  async tedarikciSil(
    @Param("id") id: string,
    @Param("tedarikciId") tedarikciId: string,
  ) {
    await this.stokService.tedarikciSil(id, tedarikciId);
  }

  // ─── STOK HAREKET UÇLARI ─────────────────────────────────────────────────

  @Post(":id/varyantlar")
  @Roller("muhasebe")
  async varyantEkle(@Param("id") id: string, @Body() govde: unknown) {
    const sonuc = stokVaryantSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.stokService.varyantEkle(id, sonuc.data);
  }

  @Patch(":id/varyantlar/:varyantId")
  @Roller("muhasebe")
  async varyantGuncelle(@Param("id") id: string, @Param("varyantId") varyantId: string, @Body() govde: unknown) {
    const sonuc = stokVaryantGuncelleSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.stokService.varyantGuncelle(id, varyantId, sonuc.data);
  }

  @Get(":id/hareketler")
  async hareketListele(
    @Param("id") id: string,
    @Query("depoId") depoId?: string,
  ) {
    return this.stokService.hareketListele(id, depoId);
  }

  @Get(":id/partiler")
  async partiListele(@Param("id") id: string, @Query("varyantId") varyantId?: string, @Query("depoId") depoId?: string, @Query("stokta") stokta?: string) {
    return this.stokService.partiListele(id, varyantId, depoId, stokta === "1" || stokta === "true");
  }

  /** Depo bazlı bakiye kırılımı (STK-07). */
  @Get(":id/depo-bakiyeleri")
  async depoKirilimi(@Param("id") id: string) {
    return this.stokService.depoKirilimi(id);
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

    return this.prisma.tenantIslem(tenantId, async (tx) =>
      this.stokService.hareketEkle(tx, {
        stokId: id,
        varyantId: girdi.varyantId,
        depoId: await this.depoService.depoCozumle(tx, girdi.depoId),
        tip: girdi.tip,
        miktar: D(girdi.miktar),
        girilenBirim: girdi.girilenBirim,
        girilenMiktar: D(girdi.girilenMiktar),
        birimMaliyet: D(girdi.maliyet),
        tarih: new Date(girdi.tarih),
        aciklama: girdi.aciklama,
        partiler: girdi.partiler.map((p) => ({ ...p, miktar: D(p.miktar) })),
      }),
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
