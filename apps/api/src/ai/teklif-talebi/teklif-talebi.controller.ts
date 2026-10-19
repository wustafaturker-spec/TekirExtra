import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { TeklifTalebiService } from "./teklif-talebi.service";

const hazirlaSemasi = z.object({ cariId: z.uuid().optional(), yeniCari: z.literal(true).optional() }).strict()
  .refine((g) => !(g.cariId && g.yeniCari), "Cari seçimi ile yeni cari birlikte verilemez");

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

  /** AI-61: eşleşmeyen/belirsiz kalem için doğru ürün; cari için hatırlanır. */
  @Post(":epostaId/urun")
  urunSec(@Param("epostaId", ParseUUIDPipe) epostaId: string, @Body() govde: unknown) {
    const s = z.object({ kalem: z.number().int().min(0).max(50), stokId: z.uuid(), varyantId: z.uuid().optional() }).strict().safeParse(govde ?? {});
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
    return this.service.urunSec(epostaId, s.data);
  }

  /** AI-64: "Teklif talebi değildi" / "Bu bir teklif talebiydi" / "Bu göndericiden teklif gelmez". */
  @Post(":epostaId/geri-bildirim")
  async geriBildirim(@Param("epostaId", ParseUUIDPipe) epostaId: string, @Body() govde: unknown) {
    const s = z.object({ tur: z.enum(["teklif_degil", "teklifti", "sustur"]) }).strict().safeParse(govde ?? {});
    if (!s.success) throw new BadRequestException("Geçerli bir geri bildirim seçin");
    return { islem: await this.service.geriBildirim(epostaId, s.data.tur) };
  }

  @Post(":epostaId/hazirla")
  hazirla(@Param("epostaId", ParseUUIDPipe) epostaId: string, @Body() govde: unknown) {
    const sonuc = hazirlaSemasi.safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.elleHazirla(epostaId, sonuc.data);
  }
}
