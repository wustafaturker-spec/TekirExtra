import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { bordroHesaplamaSemasi } from "./mevzuat.semalar";
import { MevzuatService } from "./mevzuat.service";
import { PersonelErisimGuard } from "./personel-erisim.guard";
import { bordroListeFiltreSemasi } from "./personel.semalar";
import { SaltOkumadaAcik } from "../auth/public.decorator";

/** MVZ-14: bordro mevzuatı merkezden salt okunur; yalnız görüntüleme ve ön hesaplama. */
@Controller("personel/mevzuat")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class MevzuatController {
  constructor(private readonly service: MevzuatService) {}

  @Get() listele() { return this.service.listele(); }

  @SaltOkumadaAcik() @Post("hesapla") hesapla(@Body() body: unknown) { return this.service.hesapla(bordroHesaplamaSemasi.parse(body)); }

  @Get("doneme-uygun") donemeUygun(@Query("yil") yil?: string, @Query("ay") ay?: string) {
    const f = bordroListeFiltreSemasi.parse({ yil, ay });
    if (!f.yil || !f.ay) return null;
    return this.service.donemeUygun(f.yil, f.ay);
  }
}
