import { BadRequestException, Body, Controller, Get, HttpException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import type { YuklenenDosya } from "../../ekler/ekler.service";
import { AiAjanService, type AkisOlayi, type EkranBaglami, type EkranTuru } from "./ai-ajan.service";
import { arayuzSonuclariniAyristir, ekranDurumunuAyristir } from "@tekirextra/shared";
import { SAYFA_YOLU } from "./araclar/gruplar";

type MesajGovdesi = { mesaj?: unknown; requestId?: unknown; baglam?: { cariId?: unknown; kayit?: { tur?: unknown; id?: unknown }; sayfa?: unknown; taslak?: unknown; eylem?: unknown; durum?: unknown; arayuzSonuclari?: unknown }; ekler?: unknown; derin?: unknown };

/**
 * AI-05: panel asistanı. Kimlik ve rol yalnız oturumdan gelir. Dış kanal
 * (WhatsApp vb.) webhook'u bu pakette yoktur (AI-10).
 */
@Controller("ai/ajan")
export class AiAjanController {
  constructor(private readonly ajanService: AiAjanService) {}

  @Post("mesaj")
  mesaj(@Body() body: MesajGovdesi) {
    return this.isle(body);
  }

  /**
   * AI-82: akışlı yanıt (SSE). Araç adımları `adim` olayıyla canlı akar; yanıt
   * denetimden geçince `son` olayıyla tek parça gelir. İstemci bağlantıyı
   * kapatırsa döngü bir sonraki turda durur.
   */
  @Post("mesaj-akis")
  async mesajAkis(@Body() body: MesajGovdesi, @Res() res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const yaz = (olay: string, veri: unknown) => { if (!res.writableEnded) res.write(`event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`); };
    const durdur = new AbortController();
    res.on("close", () => { if (!res.writableEnded) durdur.abort(); });
    try {
      yaz("son", await this.isle(body, { olay: (e: AkisOlayi) => yaz("adim", e), sinyal: durdur.signal }));
    } catch (hata) {
      // Tanı kodu (ör. AI_BOS_YANIT_STOP) akışsız uçtaki gibi istemciye ulaşır.
      const govde = hata instanceof HttpException ? hata.getResponse() : null;
      const hataKodu = govde && typeof govde === "object" && typeof (govde as { hataKodu?: unknown }).hataKodu === "string" ? (govde as { hataKodu: string }).hataKodu : undefined;
      yaz("hata", { mesaj: hata instanceof HttpException ? hata.message : "Asistan yanıt veremedi.", durum: hata instanceof HttpException ? hata.getStatus() : 500, ...(hataKodu ? { hataKodu } : {}) });
    } finally {
      res.end();
    }
  }

  private isle(body: MesajGovdesi, akis: { olay?: (e: AkisOlayi) => void; sinyal?: AbortSignal } = {}) {
    const cariId = body?.baglam?.cariId;
    const kayit = body?.baglam?.kayit;
    const sayfa = body?.baglam?.sayfa;
    const taslak = body?.baglam?.taslak;
    const eylem = body?.baglam?.eylem;
    const durum = ekranDurumunuAyristir(body?.baglam?.durum) ?? undefined;
    const arayuzSonuclari = arayuzSonuclariniAyristir(body?.baglam?.arayuzSonuclari);
    const ekran: EkranBaglami = {
      // CARI-48/AI-78: panelden açılan asistan; kayıt sunucuda ekran ucundan doğrulanır.
      ...(kayit && typeof kayit.tur === "string" && typeof kayit.id === "string"
        ? { kayit: { tur: kayit.tur as EkranTuru, id: kayit.id } }
        : typeof cariId === "string" ? { cariId } : {}),
      // AI-84: yalnız araç grubu seçimine girer; biçime uymayan yol yok sayılır.
      ...(typeof sayfa === "string" && SAYFA_YOLU.test(sayfa) ? { sayfa } : {}),
      // P-14a: form taslağı ve ekran eylemi panelden gönderiliyordu ama bu uçta düşüyordu; servis ikisini de güvenilmeyen veri olarak temizler.
      ...(taslak && typeof taslak === "object" && !Array.isArray(taslak) ? { taslak: taslak as Record<string, unknown> } : {}),
      ...(typeof eylem === "string" && eylem.trim() ? { eylem } : {}),
      // AI-113: liste ekranı durumu; sözleşmeye uymayan alanlar düşer.
      ...(durum ? { durum } : {}),
      // AI-114: önceki turun arayüz eylemi sonuçları (yalnız tür ve sonuç kodu).
      ...(arayuzSonuclari.length ? { arayuzSonuclari } : {}),
    };
    return this.ajanService.mesajiIsle(
      typeof body?.mesaj === "string" ? body.mesaj : "",
      typeof body?.requestId === "string" ? body.requestId : undefined,
      ekran,
      // AI-79: mesaja bağlanan sohbet ekleri; sahiplik sunucuda doğrulanır.
      Array.isArray(body?.ekler) ? body.ekler.filter((x): x is string => typeof x === "string") : [],
      // AI-81: "Derin analiz" seçimi; AI-82: akış olayları ve durdurma.
      { derin: body?.derin === true, ...akis },
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
