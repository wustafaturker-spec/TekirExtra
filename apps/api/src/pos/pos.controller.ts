import { BadRequestException, Body, Controller, Get, Header, HttpCode, HttpException, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator"; import { Public } from "../auth/public.decorator";
import { posTahsilatBaslatSemasi } from "./pos.semalar"; import { PosService } from "./pos.service";

export function odemeSonucSayfasi(basarili: boolean, tekrar = false): string {
  const baslik = basarili ? "Ödeme başarıyla tamamlandı" : "Ödeme tamamlanamadı";
  const aciklama = basarili
    ? (tekrar ? "Bu ödeme daha önce başarıyla kaydedilmişti." : "Tahsilatınız güvenli biçimde alındı ve kaydedildi.")
    : "Ödeme doğrulanamadı. Kartınızdan tahsilat yapıldıysa firma ile iletişime geçin.";
  const renk = basarili ? "#15803d" : "#b91c1c";
  const ikon = basarili ? "✓" : "!";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${baslik} — TekirExtra</title><style>body{margin:0;background:#f6f7f9;color:#172033;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.kart{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 16px 45px #17203314;max-width:520px;margin:24px;padding:42px;text-align:center}.ikon{align-items:center;background:${renk};border-radius:50%;color:#fff;display:inline-flex;font-size:34px;font-weight:700;height:68px;justify-content:center;width:68px}h1{font-size:25px;margin:24px 0 10px}p{color:#5b6475;line-height:1.6;margin:0}.marka{color:#7b8493;font-size:13px;margin-top:30px}</style></head><body><main class="kart"><div class="ikon">${ikon}</div><h1>${baslik}</h1><p>${aciklama}</p><p class="marka">TekirExtra güvenli ödeme</p></main></body></html>`;
}

@Controller("pos") export class PosController { constructor(private readonly service: PosService) {}
  @Get("tahsilatlar") @Roller("yonetici", "muhasebe") listele() { return this.service.listele(); }
  @Post("tahsilatlar") @Roller("yonetici", "muhasebe") baslat(@Body() govde: unknown) { const s = posTahsilatBaslatSemasi.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; ")); return this.service.baslat(s.data); }
  @Post("tahsilatlar/:id/eposta") @Roller("yonetici", "muhasebe") epostaYenidenGonder(@Param("id") id: string) { return this.service.epostaYenidenGonder(id); }
  @Post("tahsilatlar/:id/sms") @Roller("yonetici", "muhasebe") smsYenidenGonder(@Param("id") id: string) { return this.service.smsYenidenGonder(id); }
  @Post("iyzico/callback/:tenantId/:tahsilatId") @Public()
  async callback(@Param("tenantId") tenantId: string, @Param("tahsilatId") tahsilatId: string, @Body() govde: unknown, @Res() yanit: Response) {
    yanit.setHeader("Content-Type", "text/html; charset=utf-8");
    yanit.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    const token = typeof (govde as any)?.token === "string" ? (govde as any).token : "";
    if (!token) return yanit.status(400).send(odemeSonucSayfasi(false));
    try {
      const sonuc = await this.service.callback(tenantId, tahsilatId, token);
      return yanit.status(200).send(odemeSonucSayfasi(true, sonuc.tekrar));
    } catch (hata) {
      const durum = hata instanceof HttpException ? hata.getStatus() : 502;
      return yanit.status(durum).send(odemeSonucSayfasi(false));
    }
  }
  @Post("paytr/callback/:tenantId/:tahsilatId") @Public() @HttpCode(200) @Header("Content-Type", "text/plain") paytrCallback(@Param("tenantId") tenantId: string, @Param("tahsilatId") tahsilatId: string, @Body() govde: any) { return this.service.paytrCallback(tenantId, tahsilatId, govde); }
}
