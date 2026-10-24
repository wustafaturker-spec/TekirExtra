import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CariDurumOzetService } from "./cari-durum-ozet.service";
import { SaltOkumadaAcik } from "../../auth/public.decorator";

/** CARI-47: rol denetimi panel ucunda (`GET /cari/:id/durum`) aynen uygulanır. */
@Controller("ai/cari-durum")
export class CariDurumOzetController {
  constructor(private readonly service: CariDurumOzetService) {}

  @Get("kullanilabilir")
  kullanilabilir() {
    return this.service.kullanilabilir();
  }

  @SaltOkumadaAcik()
  @Post(":cariId/ozet")
  ozetle(@Param("cariId", ParseUUIDPipe) cariId: string) {
    return this.service.ozetle(cariId);
  }
}
