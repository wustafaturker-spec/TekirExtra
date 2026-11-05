import { BadRequestException, Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { firmaPaketIstisnaSemasi } from "../tenant/firma-paket-istisnasi";
import { PlatformFirmaIstisnaService } from "./platform-firma-istisna.service";

@PlatformUcu()
@Controller("platform/firma-istisnalari")
export class PlatformFirmaIstisnaController {
  constructor(private readonly servis: PlatformFirmaIstisnaService) {}
  @Post(":tenantId/:id/onayla")
  onayla(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("id", ParseUUIDPipe) id: string) { return this.servis.onayla(tenantId, id); }
  @Post(":tenantId/:id/fiyat-onayla")
  fiyatOnayla(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("id", ParseUUIDPipe) id: string) { return this.servis.fiyatOnayla(tenantId, id); }
  @Get(":tenantId/:id/uygunluk")
  uygunluk(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("id", ParseUUIDPipe) id: string) { return this.servis.uygunluk(tenantId, id); }
  @Get(":tenantId/kaynak")
  kaynak(@Param("tenantId", ParseUUIDPipe) tenantId: string) { return this.servis.kaynak(tenantId); }
  @Get(":tenantId")
  listele(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Query("sayfa") sayfa?: string) {
    const p = z.coerce.number().int().min(1).max(100000).default(1).safeParse(sayfa);
    if (!p.success) throw new BadRequestException("Geçersiz sayfa.");
    return this.servis.listele(tenantId, p.data);
  }
  @Post("taslak")
  taslak(@Body() body: unknown) {
    const r = firmaPaketIstisnaSemasi.safeParse(body);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
    return this.servis.taslak(r.data);
  }
  @Post(":tenantId/:id/iptal")
  iptal(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const r = z.object({ neden: z.string().trim().min(5).max(1000) }).strict().safeParse(body);
    if (!r.success) throw new BadRequestException("5–1000 karakterlik gerekçe gerekir.");
    return this.servis.iptal(tenantId, id, r.data.neden);
  }
}

@Module({ controllers: [PlatformFirmaIstisnaController], providers: [PlatformFirmaIstisnaService] })
export class PlatformFirmaIstisnaModule {}
