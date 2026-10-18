import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { TeklifTalebiService } from "./teklif-talebi.service";

const hazirlaSemasi = z.object({ cariId: z.uuid().optional() }).strict();

/** AI-32…37: gelen e-postadaki teklif talebinin işlem durumu ve elle çalıştırma. */
@Controller("ai/teklif-talepleri")
@Roller("yonetici", "muhasebe", "satis")
export class TeklifTalebiController {
  constructor(private readonly service: TeklifTalebiService) {}

  /** Kayıt yoksa `islem: null` (e-posta henüz teklif talebi olarak işlenmedi). */
  @Get(":epostaId")
  async getir(@Param("epostaId", ParseUUIDPipe) epostaId: string) {
    return { islem: await this.service.getir(epostaId) };
  }

  @Post(":epostaId/hazirla")
  hazirla(@Param("epostaId", ParseUUIDPipe) epostaId: string, @Body() govde: unknown) {
    const sonuc = hazirlaSemasi.safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.elleHazirla(epostaId, sonuc.data.cariId);
  }
}
