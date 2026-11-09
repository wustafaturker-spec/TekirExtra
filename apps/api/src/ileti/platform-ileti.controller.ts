import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { PlatformRolleri, PlatformUcu } from "../auth/public.decorator";
import { platformIletiAyariSemasi, platformSmsAyariSemasi, PlatformIletiService } from "./platform-ileti.service";

const durumSemasi = z.object({ durum: z.enum(["kuyrukta", "gonderildi", "basarisiz", "belirsiz"]).optional(), sayfa: z.coerce.number().int().min(1).max(10_000).optional() });

/** ILT-03/08: yalnız platform yöneticisi; parola hiçbir yanıtta dönmez. */
@PlatformUcu()
@PlatformRolleri("yonetici")
@Controller("platform/ileti")
export class PlatformIletiController {
  constructor(private readonly servis: PlatformIletiService) {}

  @Get("ayar")
  ayar() { return this.servis.ayarGetir(); }

  @Put("ayar")
  kaydet(@Body() govde: unknown) { return this.servis.ayarKaydet(platformIletiAyariSemasi.parse(govde)); }

  @Post("test")
  @HttpCode(200)
  test(@Body() govde: unknown) { return this.servis.testGonder(z.object({ alici: z.email() }).parse(govde).alici); }

  @Get("sms-ayar")
  smsAyar() { return this.servis.smsAyarGetir(); }

  @Put("sms-ayar")
  smsKaydet(@Body() govde: unknown) { return this.servis.smsAyarKaydet(platformSmsAyariSemasi.parse(govde)); }

  @Post("sms-test")
  @HttpCode(200)
  smsTest(@Body() govde: unknown) { return this.servis.smsTest(z.object({ telefon: z.string().min(10).max(20) }).parse(govde).telefon); }

  @Get("kayitlar")
  kayitlar(@Query() sorgu: unknown) { const q = durumSemasi.parse(sorgu); return this.servis.kayitlar(q.durum, q.sayfa); }

  @Post("kayitlar/:id/yeniden")
  @HttpCode(200)
  yeniden(@Param("id", ParseUUIDPipe) id: string) { return this.servis.yenidenGonder(id); }
}
