import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { AsistanSoruService } from "./asistan-soru.service";
import { FikirService } from "./fikir.service";

const yanitSemasi = z.object({ kod: z.string().regex(/^[a-z0-9_]{1,16}$/).optional(), metin: z.string().trim().min(1).max(200).optional() }).strict();

/**
 * CNL-09: panel "Sorular" kutusu. Yapay zekâ modülünün yolu (`ai/`): paketinde asistan olmayan
 * firmada kapalıdır. Sorunun hedefi (kişi ya da rol) serviste denetlenir.
 */
@Controller("ai/sorular")
export class AsistanSoruController {
  constructor(private readonly sorular: AsistanSoruService) {}

  @Get()
  liste() {
    return this.sorular.liste();
  }

  @Post(":id/yanit")
  @HttpCode(200)
  yanit(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = yanitSemasi.safeParse(govde);
    if (!g.success) throw new BadRequestException("Bir seçenek seçin ya da yanıt yazın.");
    return this.sorular.yanitla(id, g.data, "panel");
  }
}

const isaretSemasi = z.object({ isaret: z.enum(["yarar", "yaramaz", "getirme"]) }).strict();

/** CNL-11: haftalık fikirler ve işaretleri (panel). Fikri görme yetkisi dayandığı rapordan gelir. */
@Controller("ai/fikirler")
export class FikirController {
  constructor(private readonly fikirler: FikirService) {}

  @Get()
  liste() {
    return this.fikirler.liste();
  }

  @Post(":id/isaret")
  @HttpCode(200)
  isaret(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = isaretSemasi.safeParse(govde);
    if (!g.success) throw new BadRequestException("İşaret: işe yarar, yaramaz ya da bu konuyu getirme.");
    return this.fikirler.isaretle(id, g.data.isaret);
  }
}
