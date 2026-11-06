import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { PlatformDuyuruService } from "./platform-duyuru.service";
import { duyuruArsivSemasi, duyuruGuncelleSemasi, duyuruIcerikSemasi, duyuruListeSemasi, duyuruYayinOnizlemeSemasi, duyuruYayinOnaySemasi } from "./platform-duyuru.semalar";

function ayristir<T>(sema: z.ZodType<T>, veri: unknown): T {
  const s = sema.safeParse(veri);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
@PlatformUcu()
@Controller("platform/duyurular")
export class PlatformDuyuruController {
  constructor(private readonly duyuru: PlatformDuyuruService) {}
  @Get() listele(@Query() q: unknown) { return this.duyuru.listele(ayristir(duyuruListeSemasi, q)); }
  @Post() olustur(@Body() g: unknown) { return this.duyuru.olustur(ayristir(duyuruIcerikSemasi, g)); }
  @Post("onizleme") onizleme(@Body() g: unknown) { return this.duyuru.onizle(ayristir(duyuruIcerikSemasi, g)); }
  @Get(":id") getir(@Param("id", ParseUUIDPipe) id: string) { return this.duyuru.getir(id); }
  @Post(":id/gorsel") @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  gorselYukle(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() dosya: import("../ekler/ekler.service").YuklenenDosya | undefined) { return this.duyuru.gorselYukle(id, dosya); }
  @Patch(":id") guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.guncelle(id, ayristir(duyuruGuncelleSemasi, g)); }
  @Post(":id/arsiv") arsivle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.arsivle(id, ayristir(duyuruArsivSemasi, g).surum); }
  @Post(":id/hedef-onizle") hedefOnizle(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.hedefOnizle(id, ayristir(duyuruYayinOnizlemeSemasi, g)); }
  @Post(":id/yayinla") yayinla(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.yayinla(id, ayristir(duyuruYayinOnaySemasi, g).onizlemeId); }
  @Post(":id/durdur") durdur(@Param("id", ParseUUIDPipe) id: string, @Body() g: unknown) { return this.duyuru.durdur(id, ayristir(duyuruArsivSemasi, g).surum); }
  @Get(":id/rapor") rapor(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") sayfa?: string) { return this.duyuru.rapor(id, ayristir(duyuruListeSemasi.shape.sayfa, sayfa)); }
  @Get("firma/:tenantId") firmaGecmisi(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Query("sayfa") sayfa?: string) {
    return this.duyuru.firmaGecmisi(tenantId, ayristir(duyuruListeSemasi.shape.sayfa, sayfa));
  }
  @Get(":id/gecmis") gecmis(@Param("id", ParseUUIDPipe) id: string, @Query("sayfa") sayfa?: string) {
    return this.duyuru.gecmis(id, ayristir(duyuruListeSemasi.shape.sayfa, sayfa));
  }
}
