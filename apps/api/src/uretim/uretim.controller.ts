import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { receteKaydetSemasi, uretimEmriOlusturSemasi, uretimTamamlaSemasi } from "./uretim.semalar";
import { UretimService } from "./uretim.service";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

@Controller("uretim")
export class UretimController {
  constructor(private readonly service: UretimService) {}

  @Get("urunler") urunler() { return this.service.uretilebilirUrunler(); }
  @Get("receteler/:stokId") recete(@Param("stokId") stokId: string) { return this.service.receteGetir(stokId); }
  @Post("receteler/:stokId") @Roller("muhasebe") receteKaydet(@Param("stokId") stokId: string, @Body() govde: unknown) { return this.service.receteKaydet(stokId, ayristir(receteKaydetSemasi, govde)); }
  @Delete("receteler/:stokId") @Roller("muhasebe") @HttpCode(204) async receteSil(@Param("stokId") stokId: string) { await this.service.receteSil(stokId); }

  @Get("emirler") emirler() { return this.service.emirleriListele(); }
  @Get("emirler/:id") emir(@Param("id") id: string) { return this.service.emirGetir(id); }
  @Post("emirler") @Roller("muhasebe") emirOlustur(@Body() govde: unknown) { return this.service.emirOlustur(ayristir(uretimEmriOlusturSemasi, govde)); }
  @Post("emirler/:id/tamamla") @Roller("muhasebe") tamamla(@Param("id") id: string, @Body() govde: unknown) { return this.service.tamamla(id, ayristir(uretimTamamlaSemasi, govde)); }
  @Post("emirler/:id/iptal") @Roller("muhasebe") iptal(@Param("id") id: string) { return this.service.iptal(id); }
}
