import { Controller, Get, Query, Res } from "@nestjs/common";
import { MaliMusavirService } from "./mali-musavir.service";
import { aktifBaglam } from "../core/istek-baglami";
import type { Response } from "express";

@Controller("mali-musavir")
export class MaliMusavirController {
  constructor(private readonly maliMusavirService: MaliMusavirService) {}

  @Get("aktarim/luca-xml")
  async lucaXmlAktar(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Res() res?: Response
  ) {
    const { tenantId } = aktifBaglam();
    const xml = await this.maliMusavirService.lucaFaturaXmlAktar(
      tenantId,
      baslangic ? new Date(baslangic) : undefined,
      bitis ? new Date(bitis) : undefined
    );
    if (res) {
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", 'attachment; filename="luca-faturalar.xml"');
      res.send(xml);
    }
    return xml;
  }

  @Get("aktarim/zirve-csv")
  async zirveCsvAktar(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Res() res?: Response
  ) {
    const { tenantId } = aktifBaglam();
    const csv = await this.maliMusavirService.zirveCsvAktar(
      tenantId,
      baslangic ? new Date(baslangic) : undefined,
      bitis ? new Date(bitis) : undefined
    );
    if (res) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="zirve-hareketler.csv"');
      res.send(csv);
    }
    return csv;
  }

  @Get("kdv-ozeti")
  async kdvOzetRaporu(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string
  ) {
    const { tenantId } = aktifBaglam();
    const b = baslangic ? new Date(baslangic) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const bit = bitis ? new Date(bitis) : new Date();
    return this.maliMusavirService.kdvOzetRaporu(tenantId, b, bit);
  }
}
