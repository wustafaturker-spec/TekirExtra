import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { geriAlmaSemasi } from "./kasa-banka.semalar";
import { odemeDosyaProfiliSemasi } from "./odeme-dosyasi";
import { odemeTalimatiOlusturSemasi, odemeTalimatiTopluSemasi } from "./odeme-talimati.semalar";
import { OdemeTalimatiService } from "./odeme-talimati.service";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
const listeSemasi = z.object({ durum: z.enum(["onay_bekliyor", "onaylandi", "gonderildi", "gerceklesti", "basarisiz", "iptal"]).optional(), bankaHesapId: z.uuid().optional() });
const adaySemasi = z.object({ bankaHesapId: z.uuid({ message: "Kaynak banka hesabını seçin" }), vadeBitis: z.string().date().optional(), cariId: z.uuid().optional() });

/** ENT-07: ödeme talimatları, ödeme paketleri ve toplu ödeme dosyası. */
@Controller("kasa-banka")
@Roller("muhasebe", "yonetici", "salt_okunur")
export class OdemeTalimatiController {
  constructor(private readonly service: OdemeTalimatiService) {}

  @Get("odeme-talimatlari") listele(@Query() sorgu: unknown) { return this.service.listele(ayristir(listeSemasi, sorgu)); }
  @Get("odeme-talimatlari/aday-borclar") adaylar(@Query() sorgu: unknown) { return this.service.adayBorclar(ayristir(adaySemasi, sorgu)); }
  @Post("odeme-talimatlari") @Roller("muhasebe", "yonetici") olustur(@Body() govde: unknown) { return this.service.olustur(ayristir(odemeTalimatiOlusturSemasi, govde)); }
  @Post("odeme-talimatlari/toplu") @Roller("muhasebe", "yonetici") toplu(@Body() govde: unknown) { return this.service.topluOlustur(ayristir(odemeTalimatiTopluSemasi, govde)); }
  @Post("odeme-talimatlari/onayla") @Roller("muhasebe", "yonetici") onayla(@Body() govde: unknown) {
    const g = ayristir(z.object({ idler: z.array(z.uuid()).min(1).max(200), totpKodu: z.string().regex(/^\d{6}$/, "6 haneli doğrulama kodu gerekli") }), govde);
    return this.service.onayla(g.idler, g.totpKodu);
  }
  @Post("odeme-talimatlari/:id/iptal") @Roller("muhasebe", "yonetici") iptal(@Param("id", ParseUUIDPipe) id: string) { return this.service.iptal(id); }
  @Post("odeme-talimatlari/:id/basarisiz") @Roller("muhasebe", "yonetici") basarisiz(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) { return this.service.basarisiz(id, ayristir(geriAlmaSemasi, govde).neden); }
  @Post("odeme-talimatlari/:id/gerceklesti") @Roller("muhasebe", "yonetici") gerceklesti(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.gerceklesti(id, ayristir(z.object({ tarih: z.string().date("Tarih YYYY-MM-DD biçiminde olmalıdır") }), govde).tarih);
  }
  @Post("odeme-talimatlari/:id/gerceklesme-geri-al") @Roller("muhasebe", "yonetici") gerceklesmeGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.gerceklesmeyiGeriAl(id, ayristir(geriAlmaSemasi, govde).neden);
  }

  @Get("odeme-paketleri") paketler() { return this.service.paketler(); }
  @Post("odeme-paketleri") @Roller("muhasebe", "yonetici") paketOlustur(@Body() govde: unknown) {
    const g = ayristir(z.object({ bankaHesapId: z.uuid(), talimatIdleri: z.array(z.uuid()).min(1, "Pakete en az bir talimat seçin").max(500) }), govde);
    return this.service.paketOlustur(g.bankaHesapId, g.talimatIdleri);
  }
  @Post("odeme-paketleri/:id/iptal") @Roller("muhasebe", "yonetici") paketIptal(@Param("id", ParseUUIDPipe) id: string) { return this.service.paketIptal(id); }
  @Get("odeme-paketleri/:id/dosya") @Roller("muhasebe", "yonetici")
  async dosya(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.service.paketDosyasi(id);
    res.setHeader("Content-Type", d.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${d.dosyaAdi}"`);
    res.send(d.icerik);
  }

  @Get("bankalar/:id/odeme-dosya-profili") profil(@Param("id", ParseUUIDPipe) id: string) { return this.service.profil(id); }
  @Put("bankalar/:id/odeme-dosya-profili") @Roller("muhasebe", "yonetici") profilKaydet(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.profilKaydet(id, ayristir(odemeDosyaProfiliSemasi, govde));
  }
}
