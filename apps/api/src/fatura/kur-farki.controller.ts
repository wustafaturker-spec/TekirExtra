import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { KurFarkiService } from "./kur-farki.service";

const hareketlerSemasi = z.object({ hareketIdleri: z.array(z.uuid()).min(1).max(200) });
const durumSemasi = z.enum(["bekleyen", "islenen"]).default("bekleyen");
const tarihSemasi = z.string().date("Tarih YYYY-MM-DD biçiminde olmalıdır").optional();

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** KSB-07: gerçekleşen kur farkı faturaları ve dönem sonu değerleme raporu. */
@Controller("kur-farki")
@Roller("muhasebe", "salt_okunur")
export class KurFarkiController {
  constructor(private readonly service: KurFarkiService) {}

  @Get()
  liste(@Query("durum") durum?: string, @Query("baslangic") baslangic?: string, @Query("bitis") bitis?: string) {
    return this.service.liste(ayristir(durumSemasi, durum), ayristir(tarihSemasi, baslangic), ayristir(tarihSemasi, bitis));
  }

  @Post("faturalar")
  @Roller("muhasebe")
  faturaOlustur(@Body() govde: unknown) {
    return this.service.faturaOlustur(ayristir(hareketlerSemasi, govde).hareketIdleri);
  }

  @Post("eslestir")
  @Roller("muhasebe")
  eslestir(@Body() govde: unknown) {
    const girdi = ayristir(hareketlerSemasi.extend({ faturaId: z.uuid() }), govde);
    return this.service.gelenFaturaylaEslestir(girdi.hareketIdleri, girdi.faturaId);
  }

  @Post("kapat")
  @Roller("muhasebe")
  kapat(@Body() govde: unknown) {
    return this.service.kapat(ayristir(hareketlerSemasi, govde).hareketIdleri);
  }

  @Post("geri-ac")
  @Roller("muhasebe")
  geriAc(@Body() govde: unknown) {
    return this.service.geriAc(ayristir(hareketlerSemasi, govde).hareketIdleri);
  }

  @Get("degerleme")
  degerleme(@Query("tarih") tarih?: string) {
    return this.service.degerleme(ayristir(tarihSemasi, tarih));
  }
}
