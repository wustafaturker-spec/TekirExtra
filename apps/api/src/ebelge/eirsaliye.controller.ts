import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { GelenEirsaliyeDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EbelgeGorunumService } from "./ebelge-gorunum.service";
import { EirsaliyeService } from "./eirsaliye.service";

@Controller("ebelge/irsaliye")
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
  @Post(":belgeId/gonder") @Roller("muhasebe") gonder(@Param("belgeId") id: string) { return this.service.gonder(id); }
  @Post(":belgeId/sorgula") @Roller("muhasebe") durum(@Param("belgeId") id: string) { return this.service.durum(id); }
  @Post("gelenleri-cek") @Roller("muhasebe") gelenleriCek() { return this.service.gelenleriCek(); }
  @Get("gelen") gelenListele(@Query("durum") durum?: string) { if (durum && !["yeni", "kabul", "ret"].includes(durum)) throw new BadRequestException("Geçersiz gelen e-İrsaliye durumu"); return this.service.gelenListele(durum as GelenEirsaliyeDurum | undefined); }
  @Get("gelen/:id") gelenDetay(@Param("id") id: string) { return this.service.gelenDetay(id); }
  @Post("gelen/:id/yanit") @Roller("muhasebe") gelenYanit(@Param("id") id: string, @Body() body: { yanit?: "kabul" | "ret"; gerekce?: string }) { if (!body?.yanit || !["kabul", "ret"].includes(body.yanit)) throw new BadRequestException("Yanıt kabul veya ret olmalıdır"); return this.service.gelenYanit(id, body.yanit, body.gerekce); }
}
