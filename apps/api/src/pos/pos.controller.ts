import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { Public } from "../auth/public.decorator";
import { posIadeSemasi, posNedenSemasi, posSlipSemasi, posTahsilatBaslatSemasi, posTahsilatListeSemasi } from "./pos.semalar";
import type { z } from "zod";

function ayristir<T extends z.ZodType>(sema: T, govde: unknown): z.infer<T> {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}
import { PosService } from "./pos.service";

export function odemeSonucSayfasi(basarili: boolean, tekrar = false, makbuzUrl?: string): string {
  const baslik = basarili ? "Ödeme başarıyla tamamlandı" : "Ödeme tamamlanamadı";
  const aciklama = basarili
    ? tekrar
      ? "Bu ödeme daha önce başarıyla kaydedilmişti."
      : "Tahsilatınız güvenli biçimde alındı ve kaydedildi."
    : "Ödeme doğrulanamadı. Kartınızdan tahsilat yapıldıysa firma ile iletişime geçin.";
  const renk = basarili ? "#15803d" : "#b91c1c";
  const ikon = basarili ? "✓" : "!";
  const makbuz =
    basarili && makbuzUrl
      ? `<div class="eylemler"><a class="ana" href="${makbuzUrl}" download>Makbuzu PDF indir</a><a href="${makbuzUrl}" target="_blank" rel="noreferrer">Makbuzu görüntüle / paylaş</a></div><p class="not">Bu bağlantıyı muhasebe kayıtlarınız için saklayabilirsiniz.</p>`
      : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${baslik} — TekirExtra</title><style>body{margin:0;background:linear-gradient(145deg,#f0fdfa,#f8fafc);color:#172033;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.kart{background:#fff;border:1px solid #dbe7e6;border-radius:22px;box-shadow:0 22px 60px #0f766e1f;max-width:560px;margin:24px;padding:44px;text-align:center}.ikon{align-items:center;background:${renk};border-radius:50%;color:#fff;display:inline-flex;font-size:34px;font-weight:700;height:68px;justify-content:center;width:68px}h1{font-size:26px;margin:24px 0 10px}p{color:#5b6475;line-height:1.6;margin:0}.eylemler{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:28px}.eylemler a,.eylemler button{box-sizing:border-box;border:1px solid #0f766e;border-radius:10px;padding:12px 14px;font:600 14px system-ui;cursor:pointer;text-decoration:none}.eylemler .ana{background:#0f766e;color:#fff}.eylemler button{background:#fff;color:#0f766e}.not{font-size:12px;margin-top:12px}.marka{color:#7b8493;font-size:13px;margin-top:30px}@media(max-width:520px){.kart{padding:30px 22px}.eylemler{grid-template-columns:1fr}}</style></head><body><main class="kart"><div class="ikon">${ikon}</div><h1>${baslik}</h1><p>${aciklama}</p>${makbuz}<p class="marka">TekirExtra güvenli ödeme</p></main></body></html>`;
}

@Controller("pos")
export class PosController {
  constructor(private readonly service: PosService) {}
  @Get("tahsilatlar") @Roller("yonetici", "muhasebe") listele(@Query() sorgu: unknown) {
    const s = posTahsilatListeSemasi.safeParse(sorgu);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
    return this.service.listele(s.data);
  }
  @Post("tahsilatlar") @Roller("yonetici", "muhasebe") baslat(@Body() govde: unknown) {
    const s = posTahsilatBaslatSemasi.safeParse(govde);
    if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; "));
    return this.service.baslat(s.data);
  }
  @Post("tahsilatlar/:id/eposta") @Roller("yonetici", "muhasebe") epostaYenidenGonder(@Param("id") id: string) {
    return this.service.epostaYenidenGonder(id);
  }
  @Post("tahsilatlar/:id/sms") @Roller("yonetici", "muhasebe") smsYenidenGonder(@Param("id") id: string) {
    return this.service.smsYenidenGonder(id);
  }
  @Post("tahsilatlar/:id/yeniden-dene") @Roller("yonetici", "muhasebe") yenidenDene(@Param("id") id: string) {
    return this.service.yenidenDene(id);
  }
  // P1-6: iptal, banka POS slibi, iade ve bankaya geçecekler.
  @Post("tahsilatlar/:id/iptal") @Roller("yonetici", "muhasebe") iptal(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.iptal(id, ayristir(posNedenSemasi, govde).neden);
  }
  @Post("slip") @Roller("yonetici", "muhasebe") slipGir(@Body() govde: unknown) {
    return this.service.slipGir(ayristir(posSlipSemasi, govde));
  }
  @Post("tahsilatlar/:id/slip-geri-al") @Roller("yonetici", "muhasebe") slipGeriAl(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() govde: unknown,
  ) {
    return this.service.slipGeriAl(id, ayristir(posNedenSemasi, govde).neden);
  }
  @Post("tahsilatlar/:id/iade") @Roller("yonetici", "muhasebe") iade(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.iade(id, ayristir(posIadeSemasi, govde));
  }
  @Post("iadeler/:id/geri-al") @Roller("yonetici", "muhasebe") iadeGeriAl(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.service.iadeGeriAl(id, ayristir(posNedenSemasi, govde).neden);
  }
  @Get("bankaya-gececekler") @Roller("yonetici", "muhasebe", "salt_okunur") bankayaGececekler() {
    return this.service.bankayaGececekler();
  }
  @Post("iyzico/callback/:tenantId/:tahsilatId")
  @Public()
  async callback(
    @Param("tenantId") tenantId: string,
    @Param("tahsilatId") tahsilatId: string,
    @Body() govde: unknown,
    @Res() yanit: Response,
  ) {
    yanit.setHeader("Content-Type", "text/html; charset=utf-8");
    yanit.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    const token = typeof (govde as any)?.token === "string" ? (govde as any).token : "";
    if (!token) return yanit.status(400).send(odemeSonucSayfasi(false));
    try {
      const sonuc = await this.service.callback(tenantId, tahsilatId, token);
      const kok = process.env.PUBLIC_API_URL ?? `${yanit.req.protocol}://${yanit.req.get("host")}`;
      const makbuzUrl = `${kok}/api/v1/pos/makbuz/${tenantId}/${tahsilatId}/${sonuc.makbuzAnahtari}`;
      return yanit.status(200).send(odemeSonucSayfasi(true, sonuc.tekrar, makbuzUrl));
    } catch (hata) {
      const durum = hata instanceof HttpException ? hata.getStatus() : 502;
      return yanit.status(durum).send(odemeSonucSayfasi(false));
    }
  }
  @Get("makbuz/:tenantId/:tahsilatId/:anahtar")
  @Public()
  async makbuz(
    @Param("tenantId") tenantId: string,
    @Param("tahsilatId") tahsilatId: string,
    @Param("anahtar") anahtar: string,
    @Res() yanit: Response,
  ) {
    const pdf = await this.service.makbuzPdf(tenantId, tahsilatId, anahtar);
    yanit.setHeader("Content-Type", "application/pdf");
    yanit.setHeader("Content-Disposition", `attachment; filename="${pdf.dosyaAdi}"`);
    yanit.setHeader("Cache-Control", "private, no-store");
    yanit.send(pdf.buffer);
  }
  @Post("paytr/callback/:tenantId/:tahsilatId") @Public() @HttpCode(200) @Header("Content-Type", "text/plain") paytrCallback(
    @Param("tenantId") tenantId: string,
    @Param("tahsilatId") tahsilatId: string,
    @Body() govde: any,
  ) {
    return this.service.paytrCallback(tenantId, tahsilatId, govde);
  }
}
