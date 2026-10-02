import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import type { YuklenenDosya } from "../ekler/ekler.service";
import { geriAlmaSemasi } from "./kasa-banka.semalar";
import { cekBordroCikisSemasi, cekBordroGirisSemasi } from "./cek-bordro.semalar";
import { CekBordroService } from "./cek-bordro.service";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
const yuzSemasi = z.enum(["on", "arka"], { message: "Yüz 'on' ya da 'arka' olmalıdır" });
const listeSemasi = z.object({
  tur: z.enum(["giris", "ciro", "tahsile", "teminata", "borc_cikis"]).optional(),
  baslangic: z.string().date().optional(),
  bitis: z.string().date().optional(),
});

/** KSB-11: çek/senet bordroları ve evrak görüntüleri. */
@Controller("kasa-banka")
@Roller("muhasebe", "salt_okunur")
export class CekBordroController {
  constructor(private readonly service: CekBordroService) {}

  @Get("cek-bordrolari") listele(@Query() sorgu: unknown) { return this.service.listele(ayristir(listeSemasi, sorgu)); }
  @Get("cek-bordrolari/:id") getir(@Param("id", ParseUUIDPipe) id: string) { return this.service.getir(id); }
  @Post("cek-bordrolari/giris") @Roller("muhasebe") giris(@Body() govde: unknown) { return this.service.giris(ayristir(cekBordroGirisSemasi, govde)); }
  @Post("cek-bordrolari/cikis") @Roller("muhasebe") cikis(@Body() govde: unknown) { return this.service.cikis(ayristir(cekBordroCikisSemasi, govde)); }
  @Post("cek-bordrolari/:id/geri-al") @Roller("muhasebe") geriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.geriAl(id, ayristir(geriAlmaSemasi, govde).neden);
  }

  @Get("cek-bordrolari/:id/pdf")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Query("gorunumler") gorunumler: string | undefined, @Res() res: Response) {
    const pdf = await this.service.pdfUret(id, gorunumler === "1");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.dosyaAdi}"`);
    res.send(pdf.buffer);
  }

  @Post("cek-senet/:id/gorunum/:yuz")
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  gorunumYukle(@Param("id", ParseUUIDPipe) id: string, @Param("yuz") yuz: string, @UploadedFile() dosya: YuklenenDosya | undefined) {
    if (!dosya) throw new BadRequestException("'dosya' alanında bir görüntü yükleyin");
    return this.service.gorunumYukle(id, ayristir(yuzSemasi, yuz), dosya);
  }

  @Delete("cek-senet/:id/gorunum/:yuz")
  @Roller("muhasebe")
  gorunumSil(@Param("id", ParseUUIDPipe) id: string, @Param("yuz") yuz: string) { return this.service.gorunumSil(id, ayristir(yuzSemasi, yuz)); }
}
