import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { CalismaTakvimiService } from "./calisma-takvimi.service";

const tatilSemasi = z.object({
  tarih: z.string().date("Geçersiz tarih").transform((v) => new Date(v)),
  ad: z.string().trim().min(2, "Tatil adı en az 2 karakter olmalıdır").max(100),
  yarimGun: z.boolean().default(false),
});
const yilSemasi = z.object({ yil: z.coerce.number().int().min(2020).max(2100) });

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** Çalışma takvimi: herkes okur (üretim planı, izin sayımı), yalnız yönetici değiştirir. */
@Controller("calisma-takvimi")
export class CalismaTakvimiController {
  constructor(private readonly service: CalismaTakvimiService) {}

  @Get("tatiller") tatiller(@Query("yil") yil?: string) { return this.service.tatiller(yil ? ayristir(yilSemasi, { yil }).yil : undefined); }
  @Post("tatiller") @Roller("yonetici") tatilKaydet(@Body() govde: unknown) { return this.service.tatilKaydet(ayristir(tatilSemasi, govde)); }
  @Delete("tatiller/:id") @Roller("yonetici") @HttpCode(204) async tatilSil(@Param("id") id: string) { await this.service.tatilSil(id); }
  @Post("resmi-tatiller") @Roller("yonetici") resmiTatilleriYukle(@Body() govde: unknown) { return this.service.resmiTatilleriYukle(ayristir(yilSemasi, govde).yil); }
}
