import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { aktifBaglam } from "../../core/istek-baglami";
import { HAZIRLIK_DURUMLARI, HAZIRLIK_TURLERI, type HazirlikDurumu, type HazirlikTuru } from "./hazirlik.kurallari";
import { HazirlikService } from "./hazirlik.service";

const listeSemasi = z.object({
  kapsam: z.enum(["bana", "firma"]).default("bana"),
  durum: z.enum(HAZIRLIK_DURUMLARI as unknown as [string, ...string[]]).optional(),
  tur: z.enum(HAZIRLIK_TURLERI as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const calistirSemasi = z.object({
  turler: z.array(z.enum(HAZIRLIK_TURLERI as unknown as [string, ...string[]])).optional(),
});

const onaylaSemasi = z.object({
  oneri: z.record(z.string(), z.unknown()).optional(),
});

const topluOnaylaSemasi = z.object({
  idler: z.array(z.string().uuid()).min(1, "En az bir öğe seçilmelidir"),
});

const reddetSemasi = z.object({
  not: z.string().trim().max(500).optional(),
});

const topluReddetSemasi = z.object({
  idler: z.array(z.string().uuid()).min(1, "En az bir öğe seçilmelidir"),
  not: z.string().trim().max(500).optional(),
});

const coz = <T>(sema: z.ZodType<T>, girdi: unknown): T => {
  const s = sema.safeParse(girdi ?? {});
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
};

/**
 * P-19: Ajan hazırlık katmanı ve sabah onay kutusu uçları.
 */
@Controller("ai/hazirlik")
@Roller("yonetici", "muhasebe", "satis")
export class HazirlikController {
  constructor(private readonly hazirlik: HazirlikService) {}

  @Get()
  liste(@Query() sorgu: Record<string, string>) {
    const { kapsam, durum, tur, limit } = coz(listeSemasi, sorgu);
    return this.hazirlik.listele(kapsam, {
      durum: durum as HazirlikDurumu | undefined,
      tur: tur as HazirlikTuru | undefined,
      limit,
    });
  }

  @Post("calistir")
  calistir(@Body() govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const { turler } = coz(calistirSemasi, govde);
    return this.hazirlik.hazirla(tenantId, userId, { turler: turler as HazirlikTuru[] | undefined });
  }

  @Get("brifing-ozeti")
  brifingOzeti() {
    const { tenantId } = aktifBaglam();
    return this.hazirlik.sabahBrifingiOzeti(tenantId);
  }

  @Post(":id/onayla")
  onayla(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { oneri } = coz(onaylaSemasi, govde);
    return this.hazirlik.onayla(id, oneri);
  }

  @Post("toplu-onayla")
  topluOnayla(@Body() govde: unknown) {
    const { idler } = coz(topluOnaylaSemasi, govde);
    return this.hazirlik.topluOnayla(idler);
  }

  @Post(":id/reddet")
  reddet(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { not } = coz(reddetSemasi, govde);
    return this.hazirlik.reddet(id, not);
  }

  @Post("toplu-reddet")
  topluReddet(@Body() govde: unknown) {
    const { idler, not } = coz(topluReddetSemasi, govde);
    return this.hazirlik.topluReddet(idler, not);
  }
}
