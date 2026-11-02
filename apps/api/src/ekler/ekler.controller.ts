import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { EklerService, type YuklenenDosya } from "./ekler.service";

const sahipSemasi = z.object({
  sahipTur: z.enum(["cari", "stok", "fatura", "belge", "kasa_banka", "firma", "firma_kase", "masraf", "kira_sozlesme", "personel", "satin_alma_teklif", "demirbas"]),
  sahipId: z.string().uuid(),
});

function sahipAyristir(girdi: unknown) {
  const sonuc = sahipSemasi.safeParse(girdi);
  if (!sonuc.success) {
    throw new BadRequestException(
      "Geçerli sahipTur ve sahipId (UUID) gerekli",
    );
  }
  return sonuc.data;
}

@Controller("ekler")
export class EklerController {
  constructor(private readonly eklerService: EklerService) {}

  @Post()
  @Roller("muhasebe")
  @UseInterceptors(FileInterceptor("dosya", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async yukle(
    @UploadedFile() dosya: YuklenenDosya | undefined,
    @Query() sorgu: unknown,
  ) {
    if (!dosya) throw new BadRequestException("'dosya' alanında bir dosya yükleyin");
    const { sahipTur, sahipId } = sahipAyristir(sorgu);
    this.eklerService.ekErisiminiDenetle(sahipTur, "duzenle");
    return this.eklerService.yukle(sahipTur, sahipId, dosya);
  }

  @Get()
  async listele(@Query() sorgu: unknown) {
    const { sahipTur, sahipId } = sahipAyristir(sorgu);
    this.eklerService.ekErisiminiDenetle(sahipTur, "goruntule");
    return this.eklerService.listele(sahipTur, sahipId);
  }

  @Get(":id/indir")
  async indir(@Param("id") id: string, @Res() res: Response) {
    const { ek, icerik } = await this.eklerService.denetimliIndir(id);
    res.setHeader("Content-Type", ek.mimeTip);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(ek.dosyaAdi)}"`,
    );
    res.send(icerik);
  }

  @Delete(":id")
  @Roller("muhasebe")
  @HttpCode(204)
  async sil(@Param("id") id: string) {
    await this.eklerService.denetimliSil(id);
  }
}
