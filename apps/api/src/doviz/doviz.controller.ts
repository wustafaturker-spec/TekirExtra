import { BadRequestException, Body, Controller, Delete, Get, Post, Put, Query } from "@nestjs/common";
import type { ZodType } from "zod";
import { Roller } from "../auth/roller.decorator";
import { DovizService } from "./doviz.service";
import { elleKurSemasi, elleKurSilSemasi, kurAraligiSemasi } from "./doviz.semalar";

function dogrula<T>(sema: ZodType<T>, veri: unknown): T {
  const sonuc = sema.safeParse(veri);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
  return sonuc.data;
}

@Controller("doviz-kurlari")
export class DovizController {
  constructor(private readonly servis: DovizService) {}

  @Post("test") @Roller("muhasebe") test() { return this.servis.baglantiTesti(); }

  /** Ekranların kur isteği; kiracının o tarihte geçerli kuru (DVZ-04). */
  @Get()
  getir(@Query("tarih") tarih?: string, @Query("tip") tip?: string, @Query("yenile") yenile?: string) {
    if (tarih && !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new BadRequestException("Tarih YYYY-MM-DD biçiminde olmalıdır");
    if (tip && !["alis", "satis"].includes(tip)) throw new BadRequestException("Kur tipi alış veya satış olmalıdır");
    return this.servis.kurlariGetir(tarih, tip as "alis" | "satis" | undefined, yenile === "1");
  }

  /** DVZ-06: Ayarlar > Döviz Kurları listesi. */
  @Get("liste") @Roller("muhasebe")
  liste(@Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) {
    const aralik = dogrula(kurAraligiSemasi, { baslangic, bitis });
    return this.servis.liste(aralik.baslangic, aralik.bitis);
  }

  /** DVZ-03: aralıktaki eksik iş günlerini TCMB'den çeker. */
  @Post("eksikleri-cek") @Roller("muhasebe")
  eksikleriCek(@Body() govde: unknown) {
    const aralik = dogrula(kurAraligiSemasi, govde);
    return this.servis.eksikleriCek(new Date(`${aralik.baslangic}T00:00:00.000Z`), new Date(`${aralik.bitis}T00:00:00.000Z`));
  }

  /** DVZ-05: elle kur gir ya da değiştir. */
  @Put("elle") @Roller("muhasebe")
  elleKaydet(@Body() govde: unknown) {
    return this.servis.elleKurKaydet(dogrula(elleKurSemasi, govde));
  }

  @Delete("elle") @Roller("muhasebe")
  elleSil(@Body() govde: unknown) {
    return this.servis.elleKurSil(dogrula(elleKurSilSemasi, govde));
  }

  @Get("olaylar") @Roller("muhasebe")
  olaylar() { return this.servis.olaylar(); }
}
