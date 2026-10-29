import { BadRequestException, Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { SAGLAYICI_ALANLARI, type AbonelikSaglayiciKodu } from "./abonelik-saglayici";
import { SaglayiciAyarlariService } from "./saglayici-ayarlari.service";

const kayitSemasi = z.object({
  ortam: z.enum(["test", "canli"]),
  etkin: z.boolean(),
  alanlar: z.record(z.string(), z.string().max(500)).default({}),
});

/** PLT-11: abonelik ödeme sağlayıcısı ayarı; işaretsiz platform ucu olduğu için yalnız platform yöneticisine açık. */
@PlatformUcu()
@Controller("platform/odeme-saglayicilari")
export class PlatformOdemeController {
  constructor(private readonly ayarlar: SaglayiciAyarlariService) {}

  @Get()
  listele() {
    return this.ayarlar.listele();
  }

  @Put(":saglayici")
  kaydet(@Param("saglayici") saglayici: string, @Body() govde: unknown) {
    if (!(saglayici in SAGLAYICI_ALANLARI)) throw new BadRequestException("Bilinmeyen sağlayıcı");
    const sonuc = kayitSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.ayarlar.kaydet(saglayici as AbonelikSaglayiciKodu, sonuc.data);
  }
}
