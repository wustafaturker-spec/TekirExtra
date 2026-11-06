import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ROLLER } from "@tekirextra/shared";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { SaltOkumadaAcik } from "../auth/public.decorator";
import { duyuruOlaySemasi, duyuruTercihSemasi, tenantDuyuruListeSemasi } from "./platform-duyuru.semalar";
import { TenantDuyuruService } from "./tenant-duyuru.service";

function ayristir<T>(sema: z.ZodType<T>, veri: unknown): T {
  const r = sema.safeParse(veri);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}
@Roller(...ROLLER)
@Controller("duyurular")
export class TenantDuyuruController {
  constructor(private readonly duyuru: TenantDuyuruService) {}
  @Get() listele(@Query() q: unknown) { const g = ayristir(tenantDuyuruListeSemasi, q); return this.duyuru.listele(g.sayfa, g.gecmis === "true"); }
  @Get(":id") getir(@Param("id", ParseUUIDPipe) id: string, @Query("gecmis") gecmis?: string) {
    return this.duyuru.getir(id, ayristir(tenantDuyuruListeSemasi.shape.gecmis, gecmis) === "true");
  }
  @SaltOkumadaAcik()
  @Post(":id/olay") olay(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.olay(id, ayristir(duyuruOlaySemasi, g).tur); }
  @SaltOkumadaAcik()
  @Post(":id/tercih") tercih(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.tercih(id, ayristir(duyuruTercihSemasi, g).tur); }
}
