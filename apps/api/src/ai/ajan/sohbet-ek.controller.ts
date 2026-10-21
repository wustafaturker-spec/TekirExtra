import { BadRequestException, Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { EklerService } from "../../ekler/ekler.service";

/**
 * AI-79: sohbet ekinin XML metni; yalnız sohbetin sahibi okur (sahiplik ek
 * servisinde). Araçlar bu uçla okur; asistan servisine bağlı değildir ki araç
 * kaydı ile denetleyici arasında döngü oluşmasın.
 */
@Controller("ai/ajan/ek")
export class SohbetEkController {
  constructor(private readonly ekler: EklerService) {}

  @Get(":id/xml")
  async xml(@Param("id", ParseUUIDPipe) id: string) {
    const { ek, icerik } = await this.ekler.indir(id);
    if (ek.sahipTur !== "ai_sohbet") throw new BadRequestException("Bu ek bir sohbet eki değil");
    if (!ek.mimeTip.includes("xml")) throw new BadRequestException("Ek bir XML dosyası değil");
    return { ekId: ek.id, dosyaAdi: ek.dosyaAdi, xml: icerik.toString("utf8") };
  }
}
