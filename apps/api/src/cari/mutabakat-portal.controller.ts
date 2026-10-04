import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { MutabakatPortalService, type PortalEki } from "./mutabakat-portal.service";
import { EK_EN_BUYUK, portalYanitSemasi } from "./cari-mutabakat";

/**
 * CARI-42: karşı tarafın girişsiz mutabakat sayfasının uçları. Erişim yalnız
 * bağlantıdaki 256 bitlik anahtarla; yanıtlar önbelleğe alınmaz.
 */
@Controller("mutabakat")
@Public()
export class MutabakatPortalController {
  constructor(private readonly servis: MutabakatPortalService) {}

  @Get(":tenantId/:anahtar")
  @Header("Cache-Control", "private, no-store")
  goruntule(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("anahtar") anahtar: string) {
    return this.servis.goruntule(tenantId, anahtar);
  }

  @Get(":tenantId/:anahtar/ekstre")
  async ekstre(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("anahtar") anahtar: string, @Res() res: Response) {
    const d = await this.servis.ekstre(tenantId, anahtar);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${d.dosyaAdi}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(d.icerik);
  }

  @Post(":tenantId/:anahtar/yanit")
  @UseInterceptors(FileInterceptor("ek", { limits: { fileSize: EK_EN_BUYUK, files: 1 } }))
  yanitla(
    @Param("tenantId", ParseUUIDPipe) tenantId: string,
    @Param("anahtar") anahtar: string,
    @Body() govde: Record<string, unknown>,
    @Req() istek: Request,
    @UploadedFile() ek?: PortalEki,
  ) {
    let karsiBakiyeler: unknown;
    try { karsiBakiyeler = typeof govde.karsiBakiyeler === "string" ? JSON.parse(govde.karsiBakiyeler) : govde.karsiBakiyeler; }
    catch { throw new BadRequestException("Bakiye bilgisi okunamadı"); }
    const sonuc = portalYanitSemasi.safeParse({ ...govde, karsiBakiyeler });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    // Multer dosya adını latin1 okur; Türkçe karakterler bozulmasın.
    const dosya = ek ? { ...ek, originalname: Buffer.from(ek.originalname, "latin1").toString("utf8") } : undefined;
    return this.servis.yanitla(tenantId, anahtar, sonuc.data, dosya, { ip: istek.ip ?? null, tarayici: istek.headers["user-agent"] ?? null });
  }
}
