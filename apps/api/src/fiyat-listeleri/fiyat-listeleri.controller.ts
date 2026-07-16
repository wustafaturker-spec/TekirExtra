import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { FiyatListeleriService } from "./fiyat-listeleri.service";
import {
  fiyatListesiGuncelleSemasi,
  fiyatListesiKalemSemasi,
  fiyatListesiOlusturSemasi,
} from "./fiyat-listeleri.semalar";

@Controller("fiyat-listeleri")
export class FiyatListeleriController {
  constructor(private readonly servis: FiyatListeleriService) {}

  @Get()
  listele() {
    return this.servis.listele();
  }

  @Get(":id")
  getir(@Param("id") id: string) {
    return this.servis.getir(id);
  }

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) {
    const a = fiyatListesiOlusturSemasi.safeParse(govde);
    if (!a.success) {
      throw new BadRequestException(a.error.issues.map((s) => s.message).join("; "));
    }
    return this.servis.olustur(a.data);
  }

  @Patch(":id")
  @Roller("muhasebe")
  guncelle(@Param("id") id: string, @Body() govde: unknown) {
    const a = fiyatListesiGuncelleSemasi.safeParse(govde);
    if (!a.success) {
      throw new BadRequestException(a.error.issues.map((s) => s.message).join("; "));
    }
    return this.servis.guncelle(id, a.data);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.servis.sil(id);
  }

  @Post(":id/kalemler")
  @Roller("muhasebe")
  kalemKaydet(@Param("id") id: string, @Body() govde: unknown) {
    const a = fiyatListesiKalemSemasi.safeParse(govde);
    if (!a.success) {
      throw new BadRequestException(a.error.issues.map((s) => s.message).join("; "));
    }
    return this.servis.kalemKaydet(id, a.data);
  }

  @Delete(":id/kalemler/:kalemId")
  @Roller("muhasebe")
  @HttpCode(204)
  async kalemSil(@Param("id") id: string, @Param("kalemId") kalemId: string) {
    await this.servis.kalemSil(id, kalemId);
  }
}
