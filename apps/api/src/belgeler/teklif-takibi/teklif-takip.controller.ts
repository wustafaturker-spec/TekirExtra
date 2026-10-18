import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { TeklifTakipService } from "./teklif-takip.service";

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalı");
const elleSemasi = z.object({ tarih: tarih.optional() }).strict();
const kapatSemasi = z.object({ yanitAlindi: z.boolean(), not: z.string().trim().max(300).nullable().optional() }).strict();
const erteleSemasi = z.object({ isGunu: z.number().int().min(1).max(30) }).strict();
const gonderSemasi = z.object({
  alici: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Geçerli bir e-posta adresi girin").optional(),
  konu: z.string().trim().min(3).max(200),
  metin: z.string().trim().min(10).max(4000),
}).strict();

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde ?? {});
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** AI-38…43: satış teklifinin takibi ve kullanıcı kararları. */
@Controller("belgeler/:id/takip")
@Roller("muhasebe", "satis")
export class TeklifTakipController {
  constructor(private readonly service: TeklifTakipService) {}

  @Get()
  getir(@Param("id", ParseUUIDPipe) id: string) { return this.service.getir(id); }

  @Post("elle-gonderildi")
  elleGonderildi(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.elleGonderildi(id, ayristir(elleSemasi, govde).tarih); }

  @Post("kapat")
  kapat(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.kapat(id, ayristir(kapatSemasi, govde)); }

  @Post("ertele")
  ertele(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.ertele(id, ayristir(erteleSemasi, govde).isGunu); }

  /** Takip e-postası taslağı; gönderilmez. */
  @Post("metin")
  metin(@Param("id", ParseUUIDPipe) id: string) { return this.service.takipMetni(id); }

  @Post("gonder")
  gonder(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.takipGonder(id, ayristir(gonderSemasi, govde)); }
}
