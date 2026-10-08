import { Controller, Get, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { StokTutarlilikService } from "./stok-tutarlilik.service";

/** STK-24: stok bakiye tutarlılık denetimi ve onarımı (yalnız yönetici). */
@Controller("stok/tutarlilik")
@Roller("yonetici")
export class StokTutarlilikController {
  constructor(private readonly servis: StokTutarlilikService) {}

  @Get()
  denetle() { return this.servis.denetle(); }

  @Post("onar")
  onar() { return this.servis.onar(); }
}
