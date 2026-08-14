import { BadRequestException, Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { AbonelikService } from "./abonelik.service";

@Controller("abonelik")
@Roller("yonetici")
export class AbonelikController {
  constructor(private readonly abonelik: AbonelikService) {}

  @Get() ozet() { return this.abonelik.ozet(); }
  @Get("gecmis") gecmis() { return this.abonelik.gecmis(); }

  @Post("plan-degistir")
  planDegistir(@Body() govde: unknown) {
    const sonuc = z.object({ planKodu: z.enum(["baslangic", "profesyonel", "kurumsal"]) }).safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz plan seçimi");
    return this.abonelik.planDegistir(sonuc.data.planKodu);
  }

  @Patch("faturalama")
  iletisim(@Body() govde: unknown) {
    const sonuc = z.object({ faturaEpostasi: z.email().optional(), faturalandirmaUnvani: z.string().min(2).max(255).optional() }).safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.abonelik.iletisimGuncelle(sonuc.data);
  }

  @Post("iptal") iptal() { return this.abonelik.durumDegistir("iptal"); }
  @Post("yeniden-etkinlestir") etkinlestir() { return this.abonelik.durumDegistir("aktif"); }
}
