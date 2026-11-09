import { BadRequestException, Body, Controller, Get, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { EpostaService, epostaAyarlariSemasi } from "./eposta.service";
import { SaltOkumadaAcik } from "../auth/public.decorator";
import { SmsService } from "../ileti/sms.service";

const tarihAlani = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const gonderimSorguSemasi = z.object({ durum: z.enum(["gonderildi", "basarisiz", "belirsiz"]).optional(), tur: z.string().max(40).optional(), baslangic: tarihAlani, bitis: tarihAlani, sayfa: z.coerce.number().int().min(1).max(10_000).optional() });
const smsSorguSemasi = gonderimSorguSemasi.extend({ durum: z.enum(["gonderiliyor", "gonderildi", "basarisiz", "belirsiz"]).optional() });

@Controller("eposta")
@Roller("yonetici")
export class EpostaController {
  constructor(private readonly eposta: EpostaService, private readonly sms: SmsService) {}
  @Get("ayarlar") ayarlar() { return this.eposta.ayarlariGetir(); }
  @Put("ayarlar") ayarlariGuncelle(@Body() govde: unknown) { const s = epostaAyarlariSemasi.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")); return this.eposta.ayarlariGuncelle(s.data); }
  @SaltOkumadaAcik() @Post("test") test(@Body() govde: unknown) { const s = z.object({ alici: z.email() }).safeParse(govde); if (!s.success) throw new BadRequestException("Geçerli bir test e-posta adresi girin"); return this.eposta.baglantiTest(s.data.alici); }
  @SaltOkumadaAcik() @Post("imap-test") imapTest() { return this.eposta.imapBaglantiTest(); }
  @Get("gonderimler") @Roller("yonetici", "muhasebe") gonderimler(@Query() sorgu: unknown) { return this.eposta.gonderimler(gonderimSorguSemasi.parse(sorgu)); }
  @Get("sms-gonderimler") @Roller("yonetici", "muhasebe") smsGonderimler(@Query() sorgu: unknown) { return this.sms.kayitlar(smsSorguSemasi.parse(sorgu)); }
  @Get("gecmis") gecmis(@Query("adet") adet?: string) { return this.eposta.gecmis(adet ? Number(adet) : 50); }
}
