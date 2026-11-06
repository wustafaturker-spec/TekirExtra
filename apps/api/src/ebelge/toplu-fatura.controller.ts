import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { TopluFaturaService, topluFaturaSemasi } from "./toplu-fatura.service";

/** EBLG-152: fatura listesinden toplu kesinleştir / gönder / taslağa geri al. */
@Controller("fatura")
export class TopluFaturaController {
  constructor(private readonly toplu: TopluFaturaService) {}

  @Post("toplu")
  @Roller("muhasebe")
  async calistir(@Body() govde: unknown) {
    const girdi = topluFaturaSemasi.safeParse(govde ?? {});
    if (!girdi.success) throw new BadRequestException(girdi.error.issues.map((s) => s.message).join("; "));
    return this.toplu.calistir(girdi.data.islem, girdi.data.faturaIdler);
  }
}
