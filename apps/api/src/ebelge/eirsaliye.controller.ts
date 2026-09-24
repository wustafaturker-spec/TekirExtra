import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { GelenEirsaliyeDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EbelgeUygulamasi } from "./ebelge-uygulamasi.decorator";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { EirsaliyeService } from "./eirsaliye.service";
import { gidenDurumSemasi, topluGonderSemasi } from "./eirsaliye.semalar";

/** Yıl sorgusu; verilmezse bu yıl. */
function yilCoz(yil?: string): number {
  const deger = yil ? Number(yil) : new Date().getFullYear();
  if (!Number.isInteger(deger) || deger < 2000 || deger > 2100) throw new BadRequestException("Geçersiz yıl");
  return deger;
}

@Controller("ebelge/irsaliye")
// EBLG-77: e-İrsaliye uygulamasına kayıtlı olmayan firmada tüm uçlar kapalı.
@EbelgeUygulamasi("eirsaliye")
export class EirsaliyeController {
  constructor(private readonly service: EirsaliyeService, private readonly gorunum: EbelgeGorunumService) {}

  /** EBLG-33: gelen e-İrsaliyenin PDF görünümü; kaynak saklanan UBL'dir. */
  @Get("gelen/:id/pdf")
  async gelenPdf(@Param("id") id: string, @Res() res: Response) {
    const pdf = await this.gorunum.gelenIrsaliyePdf(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }
  /** EBLG-93: giden seride boşta kalan numaralar. */
  @Get("numara-bosluklari")
  async numaraBosluklari(@Query("yil") yil?: string) {
    return (await this.service.numaraBosluklari(yilCoz(yil))).veri;
  }

  /** EBLG-93: GİB'e verilecek dilekçe ve iç tutanak taslağı (PDF). */
  @Get("numara-bosluklari/taslak")
  async numaraBoslukTaslak(@Query("yil") yil: string | undefined, @Res() res: Response) {
    const { veri, firma } = await this.service.numaraBosluklari(yilCoz(yil));
    if (veri.bosluklar.length === 0) throw new BadRequestException("Bu yıl için boşta kalan numara yok");
    const pdf = await this.gorunum.numaraBoslukTaslakPdf(veri, firma);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }

  /** EBLG-85: giden e-İrsaliyenin çıktısı; kayıtlı olmayan alıcıya bu verilir. */
  @Get("giden/:belgeId/pdf")
  async gidenPdf(@Param("belgeId") belgeId: string, @Res() res: Response) {
    const pdf = await this.gorunum.gidenIrsaliyePdf(belgeId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }
  @Post(":belgeId/gonder") @Roller("muhasebe") gonder(@Param("belgeId") id: string) { return this.service.gonder(id); }
  @Post(":belgeId/sorgula") @Roller("muhasebe") durum(@Param("belgeId") id: string) { return this.service.durum(id); }
  @Post("gelenleri-cek") @Roller("muhasebe") gelenleriCek() { return this.service.gelenleriCek(); }

  // ─── Giden e-İrsaliyeler (EBLG-41…43) ─────────────────────────────────────
  @Get("giden") gidenListele(@Query("durum") durum?: string) { return this.service.gidenListele(gidenDurumSemasi.parse(durum)); }
  @Get("giden/:belgeId") gidenDetay(@Param("belgeId") belgeId: string) { return this.service.gidenDetay(belgeId); }
  @Post("giden/toplu-gonder") @Roller("muhasebe") topluGonder(@Body() govde: unknown) { return this.service.topluGonder(topluGonderSemasi.parse(govde).belgeIdler); }
  @Post("giden/durumlari-sorgula") @Roller("muhasebe") durumlariSorgula() { return this.service.durumlariTopluSorgula(); }
  @Get("gelen") gelenListele(@Query("durum") durum?: string) { if (durum && !["yeni", "kabul", "ret"].includes(durum)) throw new BadRequestException("Geçersiz gelen e-İrsaliye durumu"); return this.service.gelenListele(durum as GelenEirsaliyeDurum | undefined); }
  @Get("gelen/:id") gelenDetay(@Param("id") id: string) { return this.service.gelenDetay(id); }
  @Post("gelen/:id/yanit") @Roller("muhasebe") gelenYanit(@Param("id") id: string, @Body() body: { yanit?: "kabul" | "ret"; gerekce?: string }) { if (!body?.yanit || !["kabul", "ret"].includes(body.yanit)) throw new BadRequestException("Yanıt kabul veya ret olmalıdır"); return this.service.gelenYanit(id, body.yanit, body.gerekce); }
}
