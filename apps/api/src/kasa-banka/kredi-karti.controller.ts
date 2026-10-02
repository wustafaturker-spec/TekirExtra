import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { geriAlmaSemasi } from "./kasa-banka.semalar";
import { krediKartiCariOdemeSemasi, krediKartiEkstreOdemeSemasi, krediKartiGuncelleSemasi, krediKartiHareketSemasi, krediKartiKesinlestirSemasi, krediKartiOlusturSemasi } from "./kredi-karti.semalar";
import { KrediKartiService } from "./kredi-karti.service";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
const kesimSemasi = z.string().date("Kesim tarihi YYYY-MM-DD biçiminde olmalıdır");

@Controller("kasa-banka/kredi-kartlari")
@Roller("muhasebe", "salt_okunur")
export class KrediKartiController {
  constructor(private readonly service: KrediKartiService) {}

  @Get() listele() { return this.service.listele(); }
  @Post() @Roller("muhasebe") olustur(@Body() govde: unknown) { return this.service.olustur(ayristir(krediKartiOlusturSemasi, govde)); }
  @Patch(":id") @Roller("muhasebe") guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.guncelle(id, ayristir(krediKartiGuncelleSemasi, govde)); }

  /** KSB-10: dönem ekstreleri, bir dönemin kalemleri ve banka ekstresiyle kesinleştirme. */
  @Get(":id/ekstreler") ekstreler(@Param("id", ParseUUIDPipe) id: string) { return this.service.ekstreler(id); }
  @Get(":id/ekstreler/:kesim") ekstre(@Param("id", ParseUUIDPipe) id: string, @Param("kesim") kesim: string) { return this.service.ekstre(id, ayristir(kesimSemasi, kesim)); }
  @Post(":id/ekstreler/:kesim/kesinlestir") @Roller("muhasebe") kesinlestir(@Param("id", ParseUUIDPipe) id: string, @Param("kesim") kesim: string, @Body() govde: unknown) {
    return this.service.kesinlestir(id, ayristir(kesimSemasi, kesim), ayristir(krediKartiKesinlestirSemasi, govde));
  }
  @Delete(":id/ekstreler/:kesim/kesinlestir") @Roller("muhasebe") kesinlestirmeyiGeriAl(@Param("id", ParseUUIDPipe) id: string, @Param("kesim") kesim: string) {
    return this.service.kesinlestirmeyiGeriAl(id, ayristir(kesimSemasi, kesim));
  }

  @Post("hareketler") @Roller("muhasebe") hareket(@Body() govde: unknown) { return this.service.hareketEkle(ayristir(krediKartiHareketSemasi, govde)); }
  @Post("cari-odemeler") @Roller("muhasebe") cariOdeme(@Body() govde: unknown) { return this.service.cariOdeme(ayristir(krediKartiCariOdemeSemasi, govde)); }
  @Post("ekstre-odemeler") @Roller("muhasebe") ekstreOdeme(@Body() govde: unknown) { return this.service.ekstreOdeme(ayristir(krediKartiEkstreOdemeSemasi, govde)); }
  /** KSB-08: hareketi geri alır (açık dönemde siler, kapalı dönemde ya da ekstresi kesinleşmişse ters hareket). */
  @Post("hareketler/:id/geri-al") @Roller("muhasebe") geriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.hareketGeriAl(id, ayristir(geriAlmaSemasi, govde).neden); }
}
