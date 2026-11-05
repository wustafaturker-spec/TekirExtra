import { BadRequestException, Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { PlatformUcu } from "../auth/public.decorator";
import { FATURA_DURUMLARI, ODEME_KANALLARI } from "./odeme-raporu";
import { PlatformOdemeRaporuService } from "./platform-odeme-raporu.service";

const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı");
const aralikSemasi = z.object({ baslangic: gun, bitis: gun });
const sorunluSemasi = aralikSemasi.extend({
  plan: z.string().trim().max(40).default(""), firma: z.uuid().optional(),
  durum: z.enum(["hepsi", "basarisiz", "sonuclanmadi"]).default("hepsi"),
  sayfa: z.coerce.number().int().min(1).max(100000).default(1),
});
const suzgecSemasi = aralikSemasi.extend({
  arama: z.string().trim().max(100).optional().transform((v) => v || undefined),
  kanal: z.enum(ODEME_KANALLARI).optional(),
  saglayici: z.string().trim().max(20).optional().transform((v) => v || undefined),
  faturaDurumu: z.enum(FATURA_DURUMLARI).optional(),
});
const listeSemasi = suzgecSemasi.extend({
  sayfa: z.coerce.number().int().min(1).default(1),
  adet: z.coerce.number().int().min(10).max(200).default(50),
});
const disariSemasi = suzgecSemasi.extend({ bicim: z.enum(["xlsx", "csv"]).default("xlsx") });
const yaklasanSemasi = z.object({ gun: z.coerce.number().int().min(1).max(90).default(30) });

function coz<T extends z.ZodTypeAny>(sema: T, girdi: unknown): z.infer<T> {
  const sonuc = sema.safeParse(girdi);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** PLT-32…37: platform ödeme raporu. İşaretsiz platform ucu: yalnız platform yöneticisi. */
@PlatformUcu()
@Controller("platform/odeme-raporu")
export class PlatformOdemeRaporuController {
  constructor(private readonly rapor: PlatformOdemeRaporuService) {}

  @Get()
  listele(@Query() sorgu: unknown) {
    const { baslangic, bitis, sayfa, adet, ...suzgec } = coz(listeSemasi, sorgu);
    return this.rapor.rapor(baslangic, bitis, suzgec, sayfa, adet);
  }

  @Get("aylik")
  aylik() {
    return this.rapor.aylik();
  }

  @Get("sorunlu")
  sorunlu(@Query() sorgu: unknown) {
    const { baslangic, bitis, ...filtre } = coz(sorunluSemasi, sorgu);
    return this.rapor.sorunlu(baslangic, bitis, filtre);
  }

  @Get("yaklasan")
  yaklasan(@Query() sorgu: unknown) {
    return this.rapor.yaklasan(coz(yaklasanSemasi, sorgu).gun);
  }

  @Get("disari-aktar")
  async disariAktar(@Query() sorgu: unknown, @Res() res: Response) {
    const { baslangic, bitis, bicim, ...suzgec } = coz(disariSemasi, sorgu);
    const dosya = await this.rapor.disariAktar(baslangic, bitis, suzgec, bicim);
    res.setHeader("Content-Type", dosya.tur);
    res.setHeader("Content-Disposition", `attachment; filename="${dosya.dosyaAdi}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(dosya.icerik);
  }
}
