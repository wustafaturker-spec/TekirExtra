import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { z } from "zod";
import { pazaryeriFaturalastirSemasi, pazaryeriKesintiGiderlestirSemasi, pazaryeriKesintiSemasi, pazaryeriSiparisSemasi, pazaryeriSatirEsleSemasi } from "./pazaryeri.semalar";
import { PazaryeriService } from "./pazaryeri.service";

@Controller("pazaryeri")
export class PazaryeriController {
  constructor(private readonly service: PazaryeriService) {}
  // Müşterinin adı, telefonu, TCKN/VKN'si ve adresi döner; ekran yalnız muhasebede.
  @Get("siparisler") @Roller("muhasebe") listele(@Query("durum") durum?: string) { return this.service.listele(durum); }
  @Post("siparisler/ice-aktar") @Roller("yonetici")
  iceAktar(@Body() govde: unknown) {
    const sonuc = pazaryeriSiparisSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.iceAktar(sonuc.data);
  }
  @Post("siparisler/faturalastir") @Roller("yonetici", "muhasebe")
  faturalastir(@Body() govde: unknown) {
    const sonuc = pazaryeriFaturalastirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.faturalastir(sonuc.data.siparisler);
  }
  @Post("siparisler/:siparisId/satirlar/:satirId/esle") @Roller("yonetici", "muhasebe")
  satirEsle(@Param("siparisId") siparisId: string, @Param("satirId") satirId: string, @Body() govde: unknown) {
    const sonuc = pazaryeriSatirEsleSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.satirEsle(siparisId, satirId, sonuc.data);
  }
  @Post("senkronize") @Roller("yonetici", "muhasebe")
  senkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.senkronizeEt(sonuc.data.baglantiId);
  }
  @Post("stok-fiyat/senkronize") @Roller("yonetici")
  stokFiyatSenkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.stokFiyatSenkronizeEt(sonuc.data.baglantiId);
  }
  @Get("kesintiler") @Roller("yonetici", "muhasebe")
  kesintileriListele(@Query("durum") durum?: string) {
    if (durum && !["bekliyor", "giderlesti", "faturayla_eslesti", "faturasiz"].includes(durum)) throw new BadRequestException("Geçersiz kesinti durumu");
    return this.service.kesintileriListele(durum);
  }
  @Post("kesintiler/ice-aktar") @Roller("yonetici", "muhasebe")
  kesintiIceAktar(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintiIceAktar(sonuc.data);
  }
  @Post("kesintiler/giderlestir") @Roller("yonetici", "muhasebe")
  kesintileriGiderlestir(@Body() govde: unknown) {
    const sonuc = pazaryeriKesintiGiderlestirSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.service.kesintileriGiderlestir(sonuc.data);
  }
  @Post("kesintiler/senkronize") @Roller("yonetici", "muhasebe")
  kesintileriSenkronize(@Body() govde: unknown) {
    const sonuc = z.object({ baglantiId: z.string().uuid().optional() }).safeParse(govde ?? {});
    if (!sonuc.success) throw new BadRequestException("Geçersiz bağlantı");
    return this.service.kesintileriSenkronizeEt(sonuc.data.baglantiId);
  }
}
