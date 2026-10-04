import { PersonelErisimGuard } from "./personel-erisim.guard";
import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post, Body, UploadedFile, UseInterceptors, UseGuards } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Roller } from "../auth/roller.decorator";
import type { YuklenenDosya } from "../ekler/ekler.service";
import { personelBelgeMetaSemasi } from "./personel-belge.semalar";
import { PersonelBelgeService } from "./personel-belge.service";

@Controller("personel/:personelId/belgeler")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class PersonelBelgeController {
  constructor(private readonly service: PersonelBelgeService) {}

  @Get()
  listele(@Param("personelId") personelId: string) { return this.service.listele(personelId); }

  @Post()
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  yukle(@Param("personelId") personelId: string, @Body() body: unknown, @UploadedFile() dosya?: YuklenenDosya) {
    if (!dosya) throw new BadRequestException("'dosya' alanında bir dosya yükleyin");
    return this.service.yukle(personelId, personelBelgeMetaSemasi.parse(body), dosya);
  }

  @Delete(":belgeId")
  @HttpCode(204)
  sil(@Param("personelId") personelId: string, @Param("belgeId") belgeId: string) { return this.service.sil(personelId, belgeId); }
}
