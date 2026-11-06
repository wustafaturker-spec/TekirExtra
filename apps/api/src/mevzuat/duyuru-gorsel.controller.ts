import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { PlatformDuyuruService } from "./platform-duyuru.service";

@Controller("duyurular/gorseller")
export class DuyuruGorselController {
  constructor(private readonly duyuru: PlatformDuyuruService) {}

  @Public()
  @Get(":id")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Cache-Control", "private, max-age=60")
  async getir(@Param("id", ParseUUIDPipe) id: string, @Query("e") bitis: string, @Query("h") imza: string, @Res() yanit: Response) {
    if (typeof bitis !== "string" || typeof imza !== "string") throw new NotFoundException("Görsel bulunamadı veya bağlantı süresi doldu.");
    const zaman = Number(bitis);
    if (!Number.isSafeInteger(zaman) || !imza) throw new NotFoundException("Görsel bulunamadı veya bağlantı süresi doldu.");
    const { mimeTip, icerik } = await this.duyuru.gorselIndir(id, zaman, imza);
    yanit.setHeader("X-Content-Type-Options", "nosniff");
    yanit.setHeader("Cache-Control", "private, max-age=60");
    yanit.setHeader("Content-Type", mimeTip);
    yanit.setHeader("Content-Disposition", "inline");
    yanit.send(icerik);
  }
}
