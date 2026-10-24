import { BadRequestException, Body, Controller, Get, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { EpostaService, epostaAyarlariSemasi } from "./eposta.service";
import { SaltOkumadaAcik } from "../auth/public.decorator";

@Controller("eposta")
@Roller("yonetici")
export class EpostaController {
  constructor(private readonly eposta: EpostaService) {}
  @Get("ayarlar") ayarlar() { return this.eposta.ayarlariGetir(); }
  @Put("ayarlar") ayarlariGuncelle(@Body() govde: unknown) { const s = epostaAyarlariSemasi.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")); return this.eposta.ayarlariGuncelle(s.data); }
  @SaltOkumadaAcik() @Post("test") test(@Body() govde: unknown) { const s = z.object({ alici: z.email() }).safeParse(govde); if (!s.success) throw new BadRequestException("Geçerli bir test e-posta adresi girin"); return this.eposta.baglantiTest(s.data.alici); }
  @SaltOkumadaAcik() @Post("imap-test") imapTest() { return this.eposta.imapBaglantiTest(); }
  @Get("gecmis") gecmis(@Query("adet") adet?: string) { return this.eposta.gecmis(adet ? Number(adet) : 50); }
}
