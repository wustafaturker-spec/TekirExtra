import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { Roller } from "../../auth/roller.decorator";
import { kayitliModuller } from "./ayar-kayit";
import { AyarlarService } from "./ayarlar.service";

@Controller("ayarlar")
export class AyarlarController {
  constructor(private readonly ayarlar: AyarlarService) {}

  @Get()
  moduller(): { moduller: string[] } {
    return { moduller: kayitliModuller() };
  }

  @Get(":modul")
  getir(@Param("modul") modul: string): Promise<Record<string, unknown>> {
    return this.ayarlar.getir(modul);
  }

  @Put(":modul")
  @Roller("yonetici")
  guncelle(
    @Param("modul") modul: string,
    @Body() veri: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.ayarlar.guncelle(modul, veri);
  }
}
