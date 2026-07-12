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
import { KasaBankaService } from "./kasa-banka.service";
import {
  bankaHesapGuncelleSemasi,
  bankaHesapOlusturSemasi,
  cekSenetGuncelleSemasi,
  cekSenetOlusturSemasi,
  kasaBankaHareketOlusturSemasi,
  kasaGuncelleSemasi,
  kasaOlusturSemasi,
  virmanOlusturSemasi,
} from "./kasa-banka.semalar";

@Controller("kasa-banka")
export class KasaBankaController {
  constructor(private readonly service: KasaBankaService) {}

  // ─── KASA ENDPOINTS ────────────────────────────────────────────────────────

  @Get("kasalar")
  async kasaListele() {
    return this.service.kasaListele();
  }

  @Get("kasalar/:id")
  async kasaGetir(@Param("id") id: string) {
    return this.service.kasaGetir(id);
  }

  @Post("kasalar")
  @Roller("muhasebe")
  async kasaOlustur(@Body() govde: unknown) {
    const ayristirma = kasaOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.kasaOlustur(ayristirma.data);
  }

  @Patch("kasalar/:id")
  @Roller("muhasebe")
  async kasaGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = kasaGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.kasaGuncelle(id, ayristirma.data);
  }

  @Delete("kasalar/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async kasaSil(@Param("id") id: string) {
    await this.service.kasaSil(id);
  }

  // ─── BANKA ENDPOINTS ───────────────────────────────────────────────────────

  @Get("bankalar")
  async bankaListele() {
    return this.service.bankaListele();
  }

  @Get("bankalar/:id")
  async bankaGetir(@Param("id") id: string) {
    return this.service.bankaGetir(id);
  }

  @Post("bankalar")
  @Roller("muhasebe")
  async bankaOlustur(@Body() govde: unknown) {
    const ayristirma = bankaHesapOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.bankaOlustur(ayristirma.data);
  }

  @Patch("bankalar/:id")
  @Roller("muhasebe")
  async bankaGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = bankaHesapGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.bankaGuncelle(id, ayristirma.data);
  }

  @Delete("bankalar/:id")
  @Roller("muhasebe")
  @HttpCode(204)
  async bankaSil(@Param("id") id: string) {
    await this.service.bankaSil(id);
  }

  // ─── HAREKET ENDPOINTS ─────────────────────────────────────────────────────

  @Get("hareketler")
  async hareketListele(
    @Query("kasaId") kasaId?: string,
    @Query("bankaHesapId") bankaHesapId?: string,
  ) {
    return this.service.hareketListele(kasaId, bankaHesapId);
  }

  @Post("hareketler")
  @Roller("muhasebe")
  async hareketEkle(@Body() govde: unknown) {
    const ayristirma = kasaBankaHareketOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.hareketEkle(ayristirma.data);
  }

  @Post("virman")
  @Roller("muhasebe")
  async virmanEkle(@Body() govde: unknown) {
    const ayristirma = virmanOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.virmanEkle(ayristirma.data);
  }

  // ─── ÇEK & SENET ENDPOINTS ─────────────────────────────────────────────────

  @Get("cek-senet")
  async cekSenetListele(
    @Query("tur") tur?: "cek" | "senet",
    @Query("durum") durum?: string,
  ) {
    return this.service.cekSenetListele(tur, durum);
  }

  @Get("cek-senet/:id")
  async cekSenetGetir(@Param("id") id: string) {
    return this.service.cekSenetGetir(id);
  }

  @Post("cek-senet")
  @Roller("muhasebe")
  async cekSenetOlustur(@Body() govde: unknown) {
    const ayristirma = cekSenetOlusturSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.cekSenetOlustur(ayristirma.data);
  }

  @Patch("cek-senet/:id")
  @Roller("muhasebe")
  async cekSenetGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = cekSenetGuncelleSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((i) => i.message).join("; "),
      );
    }
    return this.service.cekSenetGuncelle(id, ayristirma.data);
  }
}
