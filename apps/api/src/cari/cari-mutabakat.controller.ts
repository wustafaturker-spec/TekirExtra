import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { CariMutabakatService, type MutabakatFiltresi } from "./cari-mutabakat.service";
import { DURUM_ADLARI, itirazKapatSemasi, mutabakatTalepSemasi, topluMutabakatSemasi, type MutabakatGorunenDurum } from "./cari-mutabakat";

const ayristir = <T>(sema: z.ZodType<T>, govde: unknown): T => {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
};

const talepSemasi = z.object({ cariId: z.uuid() }).and(mutabakatTalepSemasi);
const yenidenGonderSemasi = z.object({ alici: z.email("Geçerli bir e-posta adresi girin").optional().nullable() });

function filtre(cariId?: string, durum?: string, ay?: string): MutabakatFiltresi {
  if (cariId && !/^[0-9a-f-]{36}$/i.test(cariId)) throw new BadRequestException("Geçersiz cari");
  if (durum && !(durum in DURUM_ADLARI)) throw new BadRequestException("Geçersiz durum");
  if (ay && !/^\d{4}-(0[1-9]|1[0-2])$/.test(ay)) throw new BadRequestException("Ay YYYY-AA olmalıdır");
  return { cariId, durum: durum as MutabakatGorunenDurum | undefined, ay };
}

function dosyaGonder(res: Response, d: { dosyaAdi: string; mime: string; icerik: Buffer }) {
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(d.dosyaAdi)}`);
  res.send(d.icerik);
}

/** CARI-42: mutabakat talepleri (bizim taraf). */
@Controller("cari/mutabakatlar")
export class CariMutabakatController {
  constructor(private readonly servis: CariMutabakatService) {}

  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  @Get()
  listele(@Query("cariId") cariId?: string, @Query("durum") durum?: string, @Query("ay") ay?: string) {
    return this.servis.listele(filtre(cariId, durum, ay));
  }

  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  @Get("excel")
  async excel(@Res() res: Response, @Query("cariId") cariId?: string, @Query("durum") durum?: string, @Query("ay") ay?: string) {
    dosyaGonder(res, { dosyaAdi: `mutabakatlar-${new Date().toISOString().slice(0, 10)}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", icerik: await this.servis.excel(filtre(cariId, durum, ay)) });
  }

  @Post()
  @Roller("muhasebe")
  olustur(@Body() govde: unknown) {
    const { cariId, ...girdi } = ayristir(talepSemasi, govde);
    return this.servis.olustur(cariId, girdi);
  }

  @Post("toplu")
  @Roller("muhasebe")
  toplu(@Body() govde: unknown) {
    return this.servis.toplu(ayristir(topluMutabakatSemasi, govde));
  }

  @Post(":id/iptal")
  @Roller("muhasebe")
  iptal(@Param("id", ParseUUIDPipe) id: string) {
    return this.servis.iptal(id);
  }

  @Post(":id/yeniden-gonder")
  @Roller("muhasebe")
  yenidenGonder(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.servis.yenidenGonder(id, ayristir(yenidenGonderSemasi, govde ?? {}).alici);
  }

  @Post(":id/itiraz-kapat")
  @Roller("muhasebe")
  itirazKapat(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.servis.itirazKapat(id, ayristir(itirazKapatSemasi, govde).not);
  }

  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  @Get(":id/ekstre")
  async ekstre(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    dosyaGonder(res, await this.servis.ekstreIndir(id));
  }

  @Roller("muhasebe", "salt_okunur", "mali_musavir")
  @Get(":id/ek")
  async ek(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    dosyaGonder(res, await this.servis.ekIndir(id));
  }
}
