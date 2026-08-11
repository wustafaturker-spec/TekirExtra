import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { z } from "zod";
import { pazaryeriFaturalastirSemasi, pazaryeriKesintiGiderlestirSemasi, pazaryeriKesintiSemasi, pazaryeriSiparisSemasi } from "./pazaryeri.semalar";
import { PazaryeriService } from "./pazaryeri.service";

@Controller("pazaryeri")
export class PazaryeriController {
  constructor(private readonly service: PazaryeriService) {}
  @Get("siparisler") listele(@Query("durum") durum?: string) { return this.service.listele(durum); }
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
  kesintileriListele(@Query("durum") durum?: string) { return this.service.kesintileriListele(durum); }
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
