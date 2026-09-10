import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { SevkiyatService } from "./sevkiyat.service";
import {
  aracGuncelleSemasi,
  aracOlusturSemasi,
  soforGuncelleSemasi,
  soforOlusturSemasi,
} from "./sevkiyat.semalar";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) {
    throw new BadRequestException(sonuc.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; "));
  }
  return sonuc.data;
}

/** Araç ve şoför kartları (EBLG-25); irsaliyede seçilip belgeye kopyalanır. */
@Controller("sevkiyat")
export class SevkiyatController {
  constructor(private readonly servis: SevkiyatService) {}

  @Get("araclar")
  araclar(@Query("tumu") tumu?: string) {
    return this.servis.araclar(tumu !== "1");
  }

  @Post("araclar")
  @Roller("muhasebe", "satis")
  aracOlustur(@Body() govde: unknown) {
    return this.servis.aracOlustur(ayristir(aracOlusturSemasi, govde));
  }

  @Patch("araclar/:id")
  @Roller("muhasebe", "satis")
  aracGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    return this.servis.aracGuncelle(id, ayristir(aracGuncelleSemasi, govde));
  }

  @Delete("araclar/:id")
  @Roller("muhasebe", "satis")
  @HttpCode(204)
  aracSil(@Param("id") id: string) {
    return this.servis.aracSil(id);
  }

  @Get("soforler")
  soforler(@Query("tumu") tumu?: string) {
    return this.servis.soforler(tumu !== "1");
  }

  @Post("soforler")
  @Roller("muhasebe", "satis")
  soforOlustur(@Body() govde: unknown) {
    return this.servis.soforOlustur(ayristir(soforOlusturSemasi, govde));
  }

  @Patch("soforler/:id")
  @Roller("muhasebe", "satis")
  soforGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    return this.servis.soforGuncelle(id, ayristir(soforGuncelleSemasi, govde));
  }

  @Delete("soforler/:id")
  @Roller("muhasebe", "satis")
  @HttpCode(204)
  soforSil(@Param("id") id: string) {
    return this.servis.soforSil(id);
  }
}
