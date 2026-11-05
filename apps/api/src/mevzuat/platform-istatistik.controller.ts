import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { takvimGunuMu } from "@tekirextra/shared";
import { PlatformUcu } from "../auth/public.decorator";
import { istatistikFiltreSemasi } from "./platform-istatistik-filtre";
import { PlatformIstatistikService } from "./platform-istatistik.service";

const yeniden = z.object({ baslangic: z.string().refine(takvimGunuMu), bitis: z.string().refine(takvimGunuMu) }).strict();
function ayristir<T>(sema: z.ZodType<T>, g: unknown): T {
  const s = sema.safeParse(g);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
@PlatformUcu()
@Controller("platform/istatistikler")
export class PlatformIstatistikController {
  constructor(private readonly istatistik: PlatformIstatistikService) {}
  @Get() rapor(@Query() sorgu: unknown) { return this.istatistik.rapor(ayristir(istatistikFiltreSemasi, sorgu)); }
  @Post("yeniden-hesapla") yeniden(@Body() g: unknown) {
    const v = ayristir(yeniden, g);
    return this.istatistik.yenidenHesapla(v.baslangic, v.bitis);
  }
}
