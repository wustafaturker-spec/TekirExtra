import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { pazaryeriFaturalastirSemasi, pazaryeriSiparisSemasi } from "./pazaryeri.semalar";
import { PazaryeriService } from "./pazaryeri.service";

@Controller("pazaryeri")
export class PazaryeriController {
  constructor(private readonly service: PazaryeriService) {}
  @Get("siparisler") listele(@Query("durum") durum?: string) { return this.service.listele(durum); }
  @Post("siparisler/ice-aktar") @Roller("yonetici")
  iceAktar(@Body() govde: unknown) {
    const sonuc = pazaryeriSiparisSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.iceAktar(sonuc.data);
  }
  @Post("siparisler/faturalastir") @Roller("yonetici", "muhasebe")
  faturalastir(@Body() govde: unknown) {
    const sonuc = pazaryeriFaturalastirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.faturalastir(sonuc.data.siparisler);
  }
}
