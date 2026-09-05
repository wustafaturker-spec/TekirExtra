import { Controller, Get, Query, Res } from "@nestjs/common";
import { MaliMusavirService } from "./mali-musavir.service";
import { aktifBaglam } from "../core/istek-baglami";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator";

const tarihBaslangici = (deger?: string) => deger ? new Date(`${deger}T00:00:00.000`) : undefined;
const tarihSonu = (deger?: string) => deger ? new Date(`${deger}T23:59:59.999`) : undefined;

@Controller("mali-musavir")
@Roller("mali_musavir", "muhasebe")
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
      tarihBaslangici(baslangic),
      tarihSonu(bitis)
    );
    if (res) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
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
      tarihBaslangici(baslangic),
      tarihSonu(bitis)
    );
    if (res) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
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
    const b = tarihBaslangici(baslangic) ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const bit = tarihSonu(bitis) ?? new Date();
    return this.maliMusavirService.kdvOzetRaporu(tenantId, b, bit);
  }
}
