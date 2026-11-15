import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { artisKuraliSemasi, EndeksArtisService } from "./endeks-artis.service";

/**
 * END-17: kira ve tekrarlayan faturada endeksli artış. Okuma kira/tekrarlayan
 * ekranlarını görenlere, kural ve karar muhasebeye (ekranlardaki yazma rolü)
 * açıktır; plan özelliği servis içinde denetlenir.
 */
@Controller("fiyat-endeks/artislar")
export class EndeksArtisController {
  constructor(private readonly servis: EndeksArtisService) {}

  @Get("kurallar")
  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  kurallar() { return this.servis.kurallar(); }

  @Put("kurallar")
  @Roller("muhasebe")
  kuralKaydet(@Body() govde: unknown) {
    const r = artisKuraliSemasi.safeParse(govde);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join("; "));
    return this.servis.kuralKaydet(r.data);
  }

  @Get("oneriler")
  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  oneriler(@Query("durum") durum?: string) {
    if (durum && !["bekliyor", "onaylandi", "reddedildi"].includes(durum)) throw new BadRequestException("Geçersiz durum");
    return this.servis.oneriler(durum);
  }

  @Post("oneriler/:id/onayla")
  @Roller("muhasebe")
  onayla(@Param("id", ParseUUIDPipe) id: string) { return this.servis.karar(id, "onaylandi"); }

  @Post("oneriler/:id/reddet")
  @Roller("muhasebe")
  reddet(@Param("id", ParseUUIDPipe) id: string) { return this.servis.karar(id, "reddedildi"); }
}
