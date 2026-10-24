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

  /** Platform P0-1: plan değişikliği talebi; platform ekibi onaylar. */
  @Post("plan-talebi")
  planTalebi(@Body() govde: unknown) {
    const sonuc = z.object({ planKodu: z.enum(["baslangic", "profesyonel", "kurumsal"]), aciklama: z.string().max(500).optional() }).safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Geçersiz plan seçimi");
    return this.abonelik.planTalebi(sonuc.data.planKodu, sonuc.data.aciklama);
  }

  @Post("plan-talebi/geri-cek") talebiGeriCek() { return this.abonelik.talebiGeriCek(); }

  @Patch("faturalama")
  iletisim(@Body() govde: unknown) {
    const sonuc = z.object({ faturaEpostasi: z.email().optional(), faturalandirmaUnvani: z.string().min(2).max(255).optional() }).safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    return this.abonelik.iletisimGuncelle(sonuc.data);
  }

  @Post("iptal") iptal() { return this.abonelik.durumDegistir("iptal"); }
  @Post("yeniden-etkinlestir") etkinlestir() { return this.abonelik.durumDegistir("aktif"); }
}
