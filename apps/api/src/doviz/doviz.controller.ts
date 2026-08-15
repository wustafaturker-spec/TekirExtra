import { BadRequestException, Controller, Get, Post, Query } from "@nestjs/common";
import { DovizService } from "./doviz.service";

@Controller("doviz-kurlari")
export class DovizController {
  constructor(private readonly servis: DovizService) {}

  @Post("test") test() { return this.servis.baglantiTesti(); }

  @Get()
  getir(@Query("tarih") tarih?: string, @Query("tip") tip?: string, @Query("yenile") yenile?: string) {
    if (tarih && !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new BadRequestException("Tarih YYYY-MM-DD biçiminde olmalıdır");
    if (tip && !["alis", "satis"].includes(tip)) throw new BadRequestException("Kur tipi alış veya satış olmalıdır");
    return this.servis.kurlariGetir(tarih, tip as "alis" | "satis" | undefined, yenile === "1");
  }
}
