import { BadRequestException, Body, Controller, Get, Header, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { VERGI_YUKUMLULUKLERI } from "@tekirextra/shared";
import { z } from "zod";
import { PlatformRolleri, PlatformUcu } from "../auth/public.decorator";
import { excelDosyasiniDogrula, type YuklemeDosyasi } from "../core/guvenlik/dosya-dogrulama";
import { PlatformVergiTakvimiService } from "./platform-vergi-takvimi.service";

const yilSemasi = z.object({ yil: z.coerce.number().int().min(2000).max(2100) });
const taslakSemasi = z.object({
  yil: z.number().int().min(2000).max(2100),
  dayanak: z.string().trim().min(5).max(500),
  baslik: z.string().trim().max(200).nullable().optional(),
  kaynakDosya: z.string().trim().max(200).nullable().optional(),
  satirlar: z.array(z.object({ yukumluluk: z.enum(VERGI_YUKUMLULUKLERI), ay: z.number().int().min(1).max(12), sonTarih: z.string() })).min(1).max(500),
});

/** VTK-06/14: Mevzuat Merkezi'yle aynı roller; yayın dört göz akışından geçer. */
@PlatformUcu()
@PlatformRolleri("yonetici", "mevzuat_editoru")
@Controller("platform/mevzuat/vergi-takvimi")
export class PlatformVergiTakvimiController {
  constructor(private readonly servis: PlatformVergiTakvimiService) {}

  @Get()
  takvim(@Query() sorgu: unknown) {
    return this.servis.takvim(yilSemasi.parse(sorgu).yil);
  }

  @Get("sablon")
  @Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  @Header("Content-Disposition", "attachment; filename=vergi-takvimi-sablonu.xlsx")
  sablon(@Query() sorgu: unknown) {
    return this.servis.sablon(yilSemasi.parse(sorgu).yil);
  }

  @Post("onizleme")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async onizleme(@Query() sorgu: unknown, @UploadedFile() dosya: YuklemeDosyasi | undefined) {
    if (!dosya) throw new BadRequestException("Dosya seçilmedi");
    await excelDosyasiniDogrula(dosya);
    return this.servis.onizle(dosya.buffer, yilSemasi.parse(sorgu).yil, dosya.originalname);
  }

  @Post("taslak")
  taslak(@Body() govde: unknown) {
    return this.servis.taslakOlustur(taslakSemasi.parse(govde));
  }
}
