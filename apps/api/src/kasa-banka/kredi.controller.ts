import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { krediIslemSemasi, krediOlusturSemasi, KrediService, planGuncelleSemasi } from "./kredi.service";

function ayristir<T extends z.ZodTypeAny>(sema: T, deger: unknown): z.infer<T> {
  const sonuc = sema.safeParse(deger);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** KRD-01…08: banka kredileri. */
@Controller("kasa-banka/krediler")
@Roller("muhasebe", "salt_okunur")
export class KrediController {
  constructor(private readonly service: KrediService) {}

  @Get()
  listele() {
    return this.service.listele();
  }

  @Get(":id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getir(id);
  }

  @Get(":id/rotatif-faiz")
  rotatifFaiz(@Param("id", ParseUUIDPipe) id: string, @Query("bitis") bitis?: string) {
    if (bitis && !/^\d{4}-\d{2}-\d{2}$/.test(bitis)) throw new BadRequestException("Tarih YYYY-AA-GG biçiminde olmalıdır");
    return this.service.rotatifFaizi(id, bitis);
  }

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) {
    return this.service.olustur(ayristir(krediOlusturSemasi, govde));
  }

  @Patch(":id/plan")
  @Roller("muhasebe")
  planGuncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.planGuncelle(id, ayristir(planGuncelleSemasi, govde).satirlar);
  }

  @Post(":id/islemler")
  @Roller("muhasebe")
  islem(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.islem(id, ayristir(krediIslemSemasi, govde));
  }

  @Post("islemler/:islemId/geri-al")
  @Roller("muhasebe")
  geriAl(@Param("islemId", ParseUUIDPipe) islemId: string) {
    return this.service.islemGeriAl(islemId);
  }

  @Delete(":id")
  @Roller("muhasebe")
  sil(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.sil(id);
  }
}
