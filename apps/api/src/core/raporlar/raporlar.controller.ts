import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { z } from "zod";
import { RaporlarService } from "./raporlar.service";

const girdiSemasi = z.object({
  filtreler: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).optional())
    .optional(),
  gruplama: z.string().optional(),
  siralama: z
    .object({ alan: z.string(), yon: z.enum(["asc", "desc"]) })
    .optional(),
  // RPR-25
  karsilastirma: z
    .object({ tur: z.enum(["onceki", "gecen_yil", "elle"]), baslangic: z.string().optional(), bitis: z.string().optional() })
    .optional(),
});

const gorunumSemasi = z.object({
  ad: z.string().min(1).max(60),
  girdi: girdiSemasi,
  firmaGeneli: z.boolean().default(false),
});

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) {
    throw new BadRequestException(
      sonuc.error.issues.map((s) => s.message).join("; "),
    );
  }
  return sonuc.data;
}

@Controller("raporlar")
export class RaporlarController {
  constructor(private readonly raporlarService: RaporlarService) {}

  @Get()
  listele(@Query("modul") modul?: string) {
    return this.raporlarService.listele(modul);
  }

  /** RPR-28: favori ve son kullanılan raporlar. */
  @Get("tercihler")
  tercihler() {
    return this.raporlarService.tercihler();
  }

  @Post("tercihler/favori/:kod")
  favoriDegistir(@Param("kod") kod: string) {
    return this.raporlarService.favoriDegistir(kod);
  }

  @Post(":kod/calistir")
  async calistir(@Param("kod") kod: string, @Body() govde: unknown) {
    return this.raporlarService.calistir(kod, ayristir(girdiSemasi, govde ?? {}));
  }

  @Post(":kod/excel")
  async excel(
    @Param("kod") kod: string,
    @Body() govde: unknown,
    @Res() res: Response,
  ) {
    const buffer = await this.raporlarService.excel(
      kod,
      ayristir(girdiSemasi, govde ?? {}),
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=rapor-${kod.replace(/\./g, "-")}.xlsx`,
    );
    res.send(buffer);
  }

  @Post(":kod/pdf")
  async pdf(
    @Param("kod") kod: string,
    @Body() govde: unknown,
    @Res() res: Response,
  ) {
    const buffer = await this.raporlarService.pdfUret(
      kod,
      ayristir(girdiSemasi, govde ?? {}),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=rapor-${kod.replace(/\./g, "-")}.pdf`,
    );
    res.send(buffer);
  }

  @Get(":kod/gorunumler")
  gorunumler(@Param("kod") kod: string) {
    return this.raporlarService.gorunumleriListele(kod);
  }

  @Post(":kod/gorunumler")
  gorunumKaydet(@Param("kod") kod: string, @Body() govde: unknown) {
    return this.raporlarService.gorunumKaydet(kod, ayristir(gorunumSemasi, govde));
  }

  @Delete("gorunumler/:id")
  @HttpCode(204)
  async gorunumSil(@Param("id") id: string) {
    await this.raporlarService.gorunumSil(id);
  }
}
