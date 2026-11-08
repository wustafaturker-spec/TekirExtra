import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { pesinVergiGeriAlSemasi, pesinVergiMahsupSemasi, pesinVergiSorguSemasi } from "./pesin-vergi.semalar";
import { PesinVergiService } from "./pesin-vergi.service";

/** GLR-06: vergi raporuyla aynı roller (RPR-09). */
@Controller("rapor/pesin-vergiler")
@Roller("yonetici", "muhasebe", "mali_musavir")
export class PesinVergiController {
  constructor(private readonly servis: PesinVergiService) {}

  @Get()
  ozet(@Query() sorgu: unknown) {
    const { baslangic, bitis } = pesinVergiSorguSemasi.parse(sorgu);
    return this.servis.ozet(baslangic, bitis);
  }

  @Post("mahsup")
  mahsupEt(@Body() govde: unknown) {
    return this.servis.mahsupEt(pesinVergiMahsupSemasi.parse(govde));
  }

  @Post("mahsup/geri-al")
  geriAl(@Body() govde: unknown) {
    return this.servis.geriAl(pesinVergiGeriAlSemasi.parse(govde));
  }
}
