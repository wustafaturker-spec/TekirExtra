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
} from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { DepoService } from "./depo.service";
import { TransferService } from "./transfer.service";
import {
  depoGuncelleSemasi,
  depoOlusturSemasi,
  transferOlusturSemasi,
} from "./depo.semalar";

/** Depo yönetimi ve depolar arası transfer uçları (STK-07). */
@Controller("depo")
export class DepoController {
  constructor(
    private readonly depoService: DepoService,
    private readonly transferService: TransferService,
  ) {}

  // ─── TRANSFER UÇLARI (önce tanımlanmalı) ─────────────────────────────────

  @Roller("muhasebe", "salt_okunur", "uretim_planlama", "depo", "maliyet_muhasebesi")
  @Get("transferler")
  async transferListele() {
    return this.transferService.listele();
  }

  @Roller("muhasebe", "salt_okunur", "uretim_planlama", "depo", "maliyet_muhasebesi")
  @Get("transferler/:id")
  async transferGetir(@Param("id") id: string) {
    return this.transferService.getir(id);
  }

  @Post("transferler")
  @Roller("muhasebe")
  async transferOlustur(@Body() govde: unknown) {
    const ayristirma = transferOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.transferService.olustur(ayristirma.data);
  }

  @Post("transferler/:id/onayla")
  @Roller("muhasebe")
  async transferOnayla(@Param("id") id: string) {
    return this.transferService.onayla(id);
  }

  @Delete("transferler/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async transferSil(@Param("id") id: string) {
    await this.transferService.sil(id);
  }

  // ─── DEPO UÇLARI ─────────────────────────────────────────────────────────

  @Get()
  async listele(@Query("yalnizAktif") yalnizAktif?: string) {
    return this.depoService.listele(yalnizAktif === "true");
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.depoService.getir(id);
  }

  /** Deponun ürün bazlı bakiyeleri (sayım ve transfer ekranlarını besler). */
  @Roller("muhasebe", "salt_okunur", "uretim_planlama", "depo", "maliyet_muhasebesi")
  @Get(":id/bakiyeler")
  async bakiyeler(@Param("id") id: string) {
    return this.depoService.bakiyeler(id);
  }

  @Post()
  @Roller("muhasebe")
  async olustur(@Body() govde: unknown) {
    const ayristirma = depoOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.depoService.olustur(ayristirma.data);
  }

  @Patch(":id")
  @Roller("muhasebe")
  async guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = depoGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.depoService.guncelle(id, ayristirma.data);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.depoService.sil(id);
  }
}
