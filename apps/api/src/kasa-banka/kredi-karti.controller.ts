import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { krediKartiHareketSemasi, krediKartiOlusturSemasi } from "./kredi-karti.semalar";
import { KrediKartiService } from "./kredi-karti.service";
function ayristir(sema: typeof krediKartiOlusturSemasi | typeof krediKartiHareketSemasi, govde: unknown): any { const s = sema.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; ")); return s.data; }
@Controller("kasa-banka/kredi-kartlari") @Roller("muhasebe", "salt_okunur")
export class KrediKartiController { constructor(private readonly service: KrediKartiService) {} @Get() listele() { return this.service.listele(); } @Post() @Roller("muhasebe") olustur(@Body() govde: unknown) { return this.service.olustur(ayristir(krediKartiOlusturSemasi, govde)); } @Post("hareketler") @Roller("muhasebe") hareket(@Body() govde: unknown) { return this.service.hareketEkle(ayristir(krediKartiHareketSemasi, govde)); } }
