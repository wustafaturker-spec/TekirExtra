import { BadRequestException, Body, Controller, Get, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { altHesaplarSemasi, aktarimProfiliSemasi, hesapKodlariSemasi, MuhasebeAktarimService } from "./muhasebe-aktarim.service";

function ayristir<T extends z.ZodTypeAny>(sema: T, deger: unknown): z.infer<T> {
  const sonuc = sema.safeParse(deger);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** MUH-01…07: muhasebe fişi önizleme, dışa aktarım ve ayarları. */
@Controller("mali-musavir/muhasebe")
@Roller("mali_musavir", "muhasebe")
export class MuhasebeAktarimController {
  constructor(private readonly service: MuhasebeAktarimService) {}

  @Get("onizleme")
  onizleme(@Query("baslangic") baslangic = "", @Query("bitis") bitis = "") {
    return this.service.onizleme(baslangic, bitis);
  }

  @Get("disa-aktar")
  async disaAktar(@Query("baslangic") baslangic = "", @Query("bitis") bitis = "", @Query("bicim") bicim = "xlsx", @Res() res: Response) {
    if (!["xlsx", "csv", "pdf"].includes(bicim)) throw new BadRequestException("Biçim xlsx, csv ya da pdf olmalıdır");
    const dosya = await this.service.disaAktar(baslangic, bitis, bicim as "xlsx" | "csv" | "pdf");
    res.setHeader("Content-Type", dosya.tur);
    res.setHeader("Content-Disposition", `attachment; filename="${dosya.dosyaAdi}"`);
    res.send(dosya.buffer);
  }

  @Get("aktarimlar")
  aktarimlar() {
    return this.service.aktarimlar();
  }

  @Get("ayarlar")
  ayarlar() {
    return this.service.ayarlar();
  }

  @Put("ayarlar/hesap-kodlari")
  @Roller("muhasebe")
  hesapKodlari(@Body() govde: unknown) {
    return this.service.hesapKodlariKaydet(ayristir(hesapKodlariSemasi, govde));
  }

  @Put("ayarlar/profil")
  @Roller("muhasebe")
  profil(@Body() govde: unknown) {
    return this.service.profilKaydet(ayristir(aktarimProfiliSemasi, govde));
  }

  @Get("alt-hesaplar")
  altHesaplar() {
    return this.service.altHesaplar();
  }

  @Put("alt-hesaplar")
  @Roller("muhasebe")
  altHesaplariKaydet(@Body() govde: unknown) {
    return this.service.altHesaplariKaydet(ayristir(altHesaplarSemasi, govde));
  }
}
