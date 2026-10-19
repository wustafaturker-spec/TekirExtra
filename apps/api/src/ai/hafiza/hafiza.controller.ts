import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { HAFIZA_TURLERI, TERCIH_METNI } from "./hafiza.kurallari";
import { HafizaService } from "./hafiza.service";

const listeSemasi = z.object({
  tur: z.enum(HAFIZA_TURLERI as [string, ...string[]]).optional(),
  durum: z.enum(["aktif", "oneri", "pasif"]).optional(),
  cariId: z.uuid().optional(),
  sayfa: z.coerce.number().int().min(1).default(1),
  adet: z.coerce.number().int().min(1).max(100).default(50),
});

const coz = <T>(sema: z.ZodType<T>, girdi: unknown): T => {
  const s = sema.safeParse(girdi ?? {});
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
};

/** AI-59: ajan hafızası ekranı ve müşteri tercihleri. */
@Controller("ai/hafiza")
@Roller("yonetici", "muhasebe", "satis")
export class HafizaController {
  constructor(private readonly hafiza: HafizaService) {}

  @Get()
  liste(@Query() sorgu: Record<string, string>) {
    return this.hafiza.liste(coz(listeSemasi, sorgu) as Parameters<HafizaService["liste"]>[0]);
  }

  @Get("tercihler/:cariId")
  tercihler(@Param("cariId", ParseUUIDPipe) cariId: string) {
    return this.hafiza.tercihler(cariId);
  }

  @Post("tercihler/:cariId")
  async tercihEkle(@Param("cariId", ParseUUIDPipe) cariId: string, @Body() govde: unknown) {
    const { metin } = coz(z.object({ metin: z.string().trim().min(3, "Tercih en az 3 karakter olmalı").max(TERCIH_METNI) }), govde);
    const k = await this.hafiza.tercihEkle(cariId, metin, "kullanici");
    return { id: k.id, metin: k.metin, durum: k.durum, kaynak: k.kaynak };
  }

  @Patch(":id")
  durum(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { durum } = coz(z.object({ durum: z.enum(["aktif", "pasif"]) }), govde);
    return this.hafiza.durumDegistir(id, durum);
  }

  @Delete(":id")
  sil(@Param("id", ParseUUIDPipe) id: string) {
    return this.hafiza.sil(id);
  }
}
