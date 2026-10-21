import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { YuklenenDosya } from "../../ekler/ekler.service";
import { AiAjanService, type EkranTuru } from "./ai-ajan.service";

/**
 * AI-05: panel asistanı. Kimlik ve rol yalnız oturumdan gelir. Dış kanal
 * (WhatsApp vb.) webhook'u bu pakette yoktur (AI-10).
 */
@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  @Post("mesaj")
  mesaj(@Body() body: { mesaj?: unknown; requestId?: unknown; baglam?: { cariId?: unknown; kayit?: { tur?: unknown; id?: unknown } }; ekler?: unknown }) {
    const cariId = body?.baglam?.cariId;
    const kayit = body?.baglam?.kayit;
    return this.ajanService.mesajiIsle(
      typeof body?.mesaj === "string" ? body.mesaj : "",
      typeof body?.requestId === "string" ? body.requestId : undefined,
      // CARI-48/AI-78: panelden açılan asistan; kayıt sunucuda ekran ucundan doğrulanır.
      kayit && typeof kayit.tur === "string" && typeof kayit.id === "string"
        ? { kayit: { tur: kayit.tur as EkranTuru, id: kayit.id } }
        : typeof cariId === "string" ? { cariId } : undefined,
      // AI-79: mesaja bağlanan sohbet ekleri; sahiplik sunucuda doğrulanır.
      Array.isArray(body?.ekler) ? body.ekler.filter((x): x is string => typeof x === "string") : [],
    );
  }

  /** AI-79: sohbete dosya eki (PDF, görsel, UBL XML; en çok 10 MB; içerik ve virüs denetimi). */
  @Post("ek")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  ekYukle(@UploadedFile() dosya: YuklenenDosya | undefined) {
    if (!dosya) throw new BadRequestException("'dosya' alanında bir dosya yükleyin");
    return this.ajanService.ekYukle(dosya);
  }

  @Get("gecmis")
  gecmis(@Query("oturumId") oturumId?: string) {
    return this.ajanService.gecmis(oturumId);
  }

  @Post("mesajlar/:id/geri-bildirim")
  geriBildirim(@Param("id") id: string, @Body() body: unknown) {
    return this.ajanService.geriBildirim(id, body);
  }

  @Get("sohbetler")
  sohbetler() {
    return this.ajanService.sohbetler();
  }

  @Post("sohbetler/yeni")
  yeniSohbet() {
    return this.ajanService.yeniSohbet();
  }

  @Post("sohbetler/:id/etkinlestir")
  sohbetEtkinlestir(@Param("id") id: string) {
    return this.ajanService.sohbetEtkinlestir(id);
  }

  @Post("sohbetler/:id/arsivle")
  sohbetArsivle(@Param("id") id: string) {
    return this.ajanService.sohbetArsivle(id);
  }
}
