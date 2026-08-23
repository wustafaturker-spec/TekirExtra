import { BadRequestException, Controller, Get, Post, Put, Patch, Body, Param, Query } from "@nestjs/common";
import { CrmFirsatService } from "./crm-firsat.service";
import { firsatOlusturSemasi, firsatGuncelleSemasi, firsatAsamaDegistirSemasi, firsatAsamaFiltreSemasi } from "./crm-firsat.semalar";
import { aktifBaglam } from "../core/istek-baglami";
import { Roller } from "../auth/roller.decorator";

@Controller("crm/firsatlar")
export class CrmFirsatController {
  constructor(private readonly firsatService: CrmFirsatService) {}

  @Get()
  @Roller("yonetici", "satis", "muhasebe")
  async listele(@Query("asama") asama?: string) {
    const { tenantId } = aktifBaglam();
    if (asama && !firsatAsamaFiltreSemasi.safeParse(asama).success) throw new BadRequestException("Geçersiz CRM aşaması");
    return this.firsatService.listele(tenantId, asama);
  }

  @Get(":id")
  @Roller("yonetici", "satis", "muhasebe")
  async getir(@Param("id") id: string) {
    const { tenantId } = aktifBaglam();
    return this.firsatService.getir(tenantId, id);
  }

  @Post()
  @Roller("yonetici", "satis")
  async olustur(@Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = firsatOlusturSemasi.parse(body);
    return this.firsatService.olustur(tenantId, veri);
  }

  @Put(":id")
  @Roller("yonetici", "satis")
  async guncelle(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = firsatGuncelleSemasi.parse(body);
    return this.firsatService.guncelle(tenantId, id, veri);
  }

  @Patch(":id/asama")
  @Roller("yonetici", "satis")
  async asamaDegistir(@Param("id") id: string, @Body() body: unknown) {
    const { tenantId } = aktifBaglam();
    const veri = firsatAsamaDegistirSemasi.parse(body);
    return this.firsatService.asamaDegistir(tenantId, id, veri);
  }
}
