import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { takvimGunuMu } from "@tekirextra/shared";
import { PlatformUcu } from "../auth/public.decorator";
import { PlatformFirmaTakipService } from "./platform-firma-takip.service";

export const firmaTakipSemasi = z.object({
  sorumluId: z.uuid().nullable(),
  durum: z.enum(["acik", "bekliyor", "tamamlandi"]),
  sonrakiGorusme: z.string().refine(takvimGunuMu, "Geçerli bir görüşme tarihi girin.").nullable(),
  surum: z.number().int().min(0),
}).strict();
export const firmaNotSemasi = z.object({ metin: z.string().trim().min(1).max(4000), islemAnahtari: z.uuid() }).strict();
const sayfaSemasi = z.coerce.number().int().min(1).max(100000).default(1);
function ayristir<T>(sema: z.ZodType<T>, veri: unknown): T {
  const s = sema.safeParse(veri);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}

@PlatformUcu()
@Controller("platform/firmalar")
export class PlatformFirmaTakipController {
  constructor(private readonly takip: PlatformFirmaTakipService) {}
  @Get("takip-sorumlulari") sorumlular() { return this.takip.sorumlular(); }
  @Get(":id/takip") getir(@Param("id", ParseUUIDPipe) id: string) { return this.takip.getir(id); }
  @Patch(":id/takip") guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.takip.guncelle(id, ayristir(firmaTakipSemasi, g)); }
  @Get(":id/notlar") notlar(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") sayfa?: string) { return this.takip.notlar(id, ayristir(sayfaSemasi, sayfa)); }
  @Post(":id/notlar") notEkle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.takip.notEkle(id, ayristir(firmaNotSemasi, g)); }
  @Get(":id/olaylar") olaylar(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") sayfa?: string) { return this.takip.olaylar(id, ayristir(sayfaSemasi, sayfa)); }
}
