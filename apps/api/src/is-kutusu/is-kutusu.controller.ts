import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { IsKutusuService, type Kapsam } from "./is-kutusu.service";

/** AI-48…51: teklif iş kutusu (yönetici, muhasebe, satış). */
@Controller("is-kutusu")
@Roller("muhasebe", "satis")
export class IsKutusuController {
  constructor(private readonly service: IsKutusuService) {}

  @Get()
  listele(@Query("kapsam") kapsam?: string) {
    if (kapsam !== undefined && kapsam !== "bana" && kapsam !== "firma") throw new BadRequestException("Kapsam bana ya da firma olmalı");
    return this.service.listele((kapsam as Kapsam | undefined) ?? "bana");
  }

  @Get("sayac")
  sayac() { return this.service.sayac(); }
}
