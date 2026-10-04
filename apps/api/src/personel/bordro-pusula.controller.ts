import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { BordroPusulaService } from "./bordro-pusula.service";

const tekilSema = z.object({ alici: z.email("Geçerli bir e-posta adresi girin").optional().nullable() });
const topluSema = z.object({ yil: z.coerce.number().int().min(2020).max(2100), ay: z.coerce.number().int().min(1).max(12) });

/** PRS-10: ücret hesap pusulası (İş K. m.37). */
@Controller("personel/pusulalar")
@Roller("muhasebe")
export class BordroPusulaController {
  constructor(private readonly servis: BordroPusulaService) {}

  @Get(":bordroId/pdf")
  async pdf(@Param("bordroId", ParseUUIDPipe) bordroId: string, @Res() res: Response) {
    const { buffer, dosyaAdi } = await this.servis.pdfUret(bordroId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${dosyaAdi}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  }

  @Post(":bordroId/eposta")
  epostala(@Param("bordroId", ParseUUIDPipe) bordroId: string, @Body() govde: unknown) {
    const g = tekilSema.safeParse(govde ?? {});
    if (!g.success) throw new BadRequestException(g.error.issues.map((s) => s.message).join("; "));
    return this.servis.epostala(bordroId, g.data.alici);
  }

  @Post("toplu-eposta")
  topluEpostala(@Body() govde: unknown) {
    const g = topluSema.safeParse(govde ?? {});
    if (!g.success) throw new BadRequestException("Dönem için yıl ve ay zorunludur");
    return this.servis.topluEpostala(g.data.yil, g.data.ay);
  }
}
