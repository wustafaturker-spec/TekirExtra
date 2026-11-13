import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type { ZodType } from "zod";
import { Roller } from "../auth/roller.decorator";
import { kategoriGuncelleSemasi, kategoriOlusturSemasi, kiraDonemOlusturSemasi, kiraSozlesmeGuncelleSemasi, kiraSozlesmeOlusturSemasi, masrafGuncelleSemasi, masrafOdemeSemasi, masrafOlusturSemasi, oranlaraGoreMasrafSemasi } from "./masraflar.semalar";
import { MasraflarService } from "./masraflar.service";

function ayristir<T>(sema: ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

@Controller("masraflar")
export class MasraflarController {
  constructor(private readonly service: MasraflarService) {}
  @Get("kategoriler") @Roller("muhasebe", "salt_okunur", "mali_musavir", "depo") kategoriListele() { return this.service.kategoriListele(); }
  @Post("kategoriler") @Roller("muhasebe") kategoriOlustur(@Body() g: unknown) { return this.service.kategoriOlustur(ayristir(kategoriOlusturSemasi, g)); }
  @Patch("kategoriler/:id") @Roller("muhasebe") kategoriGuncelle(@Param("id") id: string, @Body() g: unknown) { return this.service.kategoriGuncelle(id, ayristir(kategoriGuncelleSemasi, g)); }
  @Get("kiralar") @Roller("muhasebe", "salt_okunur", "mali_musavir", "depo") kiraListele() { return this.service.kiraSozlesmeListele(); }
  @Post("kiralar") @Roller("muhasebe") kiraOlustur(@Body() g: unknown) { return this.service.kiraSozlesmeOlustur(ayristir(kiraSozlesmeOlusturSemasi, g)); }
  @Patch("kiralar/:id") @Roller("muhasebe") kiraGuncelle(@Param("id") id: string, @Body() g: unknown) { return this.service.kiraSozlesmeGuncelle(id, ayristir(kiraSozlesmeGuncelleSemasi, g)); }
  @Delete("kiralar/:id") @Roller("muhasebe") @HttpCode(204) kiraSil(@Param("id") id: string) { return this.service.kiraSozlesmeSil(id); }
  @Post("kiralar/:id/donem") @Roller("muhasebe") kiraDonem(@Param("id") id: string, @Body() g: unknown) { return this.service.kiraDonemiOlustur(id, ayristir(kiraDonemOlusturSemasi, g)); }
  @Post("kiralar/:id/aktiflik") @Roller("muhasebe") kiraAktiflik(@Param("id") id: string, @Body() g: unknown) {
    if (typeof (g as { aktif?: unknown })?.aktif !== "boolean") throw new BadRequestException("aktif alanı boolean olmalıdır");
    return this.service.kiraSozlesmeAktiflik(id, (g as { aktif: boolean }).aktif);
  }
  @Get("sayfa") @Roller("muhasebe", "salt_okunur", "mali_musavir", "depo") sayfa(@Query() q: Record<string, string>) { return this.service.sayfa(q); }
  @Get() @Roller("muhasebe", "salt_okunur", "mali_musavir", "depo") listele(@Query() q: Record<string, string>) { return this.service.listele(q); }
  @Get(":id") @Roller("muhasebe", "salt_okunur", "mali_musavir", "depo") getir(@Param("id") id: string) { return this.service.getir(id); }
  @Post() @Roller("muhasebe") olustur(@Body() g: unknown) { return this.service.olustur(ayristir(masrafOlusturSemasi, g)); }
  /** AI-13 */
  @Post("oranlara-gore") @Roller("muhasebe") oranlaraGore(@Body() g: unknown) { return this.service.oranlaraGoreOlustur(ayristir(oranlaraGoreMasrafSemasi, g)); }
  @Patch(":id") @Roller("muhasebe") guncelle(@Param("id") id: string, @Body() g: unknown) { return this.service.guncelle(id, ayristir(masrafGuncelleSemasi, g)); }
  @Post(":id/onayla") @Roller("muhasebe") onayla(@Param("id") id: string) { return this.service.onayla(id); }
  @Post(":id/ode") @Roller("muhasebe") ode(@Param("id") id: string, @Body() g: unknown) { return this.service.ode(id, ayristir(masrafOdemeSemasi, g)); }
  @Post(":id/iptal") @Roller("muhasebe") iptal(@Param("id") id: string) { return this.service.iptal(id); }
}
