import { Controller, Param, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { EbelgeService } from "./ebelge.service";

@Controller("ebelge")
export class EbelgeController {
  constructor(private readonly ebelgeService: EbelgeService) {}

  @Post("gonder/:faturaId")
  @Roller("muhasebe")
  async gonder(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.gonder(faturaId);
  }

  @Post("sorgula/:faturaId")
  @Roller("muhasebe")
  async sorgula(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.durumSorgula(faturaId);
  }

  @Post("gelenleri-cek")
  @Roller("muhasebe")
  async gelenleriCek() {
    return this.ebelgeService.gelenBelgeleriCek();
  }
}
