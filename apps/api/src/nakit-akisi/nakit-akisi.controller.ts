import { Controller, Get, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { NakitAkisiService } from "./nakit-akisi.service";
import { NakitPozisyonuService } from "./nakit-pozisyonu.service";
import { nakitAkisiSorguSemasi } from "./nakit-akisi.semalar";

/** NAK-13: yalnız yönetici ve muhasebe (yönetici her uca zaten erişir). */
@Controller("nakit-akisi")
@Roller("muhasebe")
export class NakitAkisiController {
  constructor(private readonly service: NakitAkisiService, private readonly pozisyonServisi: NakitPozisyonuService) {}

  @Get()
  tahmin(@Query("ufuk") ufuk?: string) {
    const girdi = nakitAkisiSorguSemasi.parse({ ufuk });
    return this.service.tahmin(girdi.ufuk);
  }

  /** NAK-15: anlık nakit pozisyonu ve 7/30 günlük vadeler. */
  @Get("pozisyon")
  pozisyon() {
    return this.pozisyonServisi.pozisyon();
  }
}
