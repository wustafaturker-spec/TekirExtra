import { BadRequestException, Body, Controller, Get, HttpException, Param, ParseUUIDPipe, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { ABONELIK_SURELERI, tlYaz, type AbonelikSuresi } from "./abonelik-tutari";
import { AbonelikOdemeService } from "./abonelik-odeme.service";
import { baglantiAnahtariDogrula } from "./baglanti-anahtari";

const sureSemasi = z.coerce.number().refine((a): a is AbonelikSuresi => (ABONELIK_SURELERI as readonly number[]).includes(a), "Süre 1, 3, 6 ya da 12 ay olmalı");

/** PLT-13: panelden "Şimdi öde". Yol /abonelik/ altında olduğu için askıdaki firmada da açıktır. */
@Controller("abonelik/odeme")
@Roller("yonetici")
export class AbonelikOdemeController {
  constructor(private readonly odeme: AbonelikOdemeService) {}

  @Get()
  durum() {
    return this.odeme.durum(aktifBaglam().tenantId);
  }

  @Post()
  baslat(@Body() govde: unknown, @Req() istek: Request) {
    const sonuc = z.object({ aySayisi: sureSemasi }).safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId } = aktifBaglam();
    return this.odeme.baslat(tenantId, sonuc.data.aySayisi, "panel", userId, istek.ip);
  }
}

const kacis = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const gun = (d: Date | null) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

/** Sağlayıcı sayfasına giden/dönen kullanıcıya gösterilen sade sayfa (betik yok). */
export function abonelikSayfasi(baslik: string, govde: string, basarili?: boolean): string {
  const ikon = basarili === undefined ? "" : `<div class="ikon" style="background:${basarili ? "#15803d" : "#b91c1c"}">${basarili ? "✓" : "!"}</div>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kacis(baslik)} — TekirExtra</title><style>body{margin:0;background:#f8fafc;color:#172033;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.kart{background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 18px 50px #0f172a14;max-width:560px;margin:16px;padding:36px;text-align:center}.ikon{align-items:center;border-radius:50%;color:#fff;display:inline-flex;font-size:30px;font-weight:700;height:60px;justify-content:center;width:60px}h1{font-size:24px;margin:18px 0 10px}p{color:#5b6475;line-height:1.6;margin:0 0 10px}form{display:grid;gap:10px;margin-top:20px}button{border:1px solid #ea580c;border-radius:10px;background:#fff;color:#172033;padding:12px 14px;font:600 15px system-ui;cursor:pointer;display:flex;justify-content:space-between}button.ana{background:#ea580c;color:#fff}a.dugme{display:inline-block;margin-top:18px;background:#ea580c;color:#fff;border-radius:10px;padding:12px 18px;font-weight:600;text-decoration:none}.kucuk{font-size:12px;color:#7b8493}</style></head><body><main class="kart">${ikon}<h1>${kacis(baslik)}</h1>${govde}<p class="kucuk" style="margin-top:22px">TekirExtra güvenli ödeme · kart bilgileriniz ödeme kuruluşunun sayfasında girilir</p></main></body></html>`;
}

function sayfaGonder(yanit: Response, durum: number, html: string) {
  yanit.setHeader("Content-Type", "text/html; charset=utf-8");
  yanit.setHeader("Cache-Control", "no-store");
  yanit.setHeader("Referrer-Policy", "no-referrer");
  // form-action yazılmaz: form gönderimi sağlayıcının sayfasına yönlenir.
  yanit.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return yanit.status(durum).send(html);
}

const panelAdresi = () => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/panel/ayarlar/abonelik`;

/** PLT-13: oturumsuz uçlar — e-postadaki ödeme bağlantısı ve sağlayıcının dönüşü. */
@Controller("abonelik-odeme")
export class AbonelikOdemePublicController {
  constructor(private readonly odeme: AbonelikOdemeService) {}

  @Public()
  @Get("baglanti/:anahtar")
  async baglanti(@Param("anahtar") anahtar: string, @Res() yanit: Response) {
    const tenantId = baglantiAnahtariDogrula(anahtar);
    if (!tenantId) return sayfaGonder(yanit, 404, abonelikSayfasi("Bağlantının süresi dolmuş", `<p>Bu ödeme bağlantısı geçersiz ya da süresi dolmuş. Ödemeyi TekirExtra panelinde Ayarlar › Abonelik sayfasından yapabilirsiniz.</p><a class="dugme" href="${kacis(panelAdresi())}">Panele git</a>`, false));
    try {
      const o = await this.odeme.baglantiOzeti(tenantId);
      if (!o.acik || !o.secenekler.length) return sayfaGonder(yanit, 200, abonelikSayfasi("Çevrim içi ödeme açık değil", "<p>Ödeme bilgileri için bu e-postayı yanıtlayarak TekirExtra ekibine ulaşabilirsiniz.</p>"));
      const dugmeler = o.secenekler.map((t, i) => `<button type="submit" name="aySayisi" value="${t.aySayisi}"${i === 0 ? ' class="ana"' : ""}><span>${t.aySayisi} ay</span><span>${tlYaz(t.toplam)} TL</span></button>`).join("");
      return sayfaGonder(yanit, 200, abonelikSayfasi("Abonelik ödemesi", `<p><strong>${kacis(o.unvan)}</strong> · ${kacis(o.planAdi)} planı</p><p>Dönem sonu: ${gun(o.donemSonu)}. Seçtiğiniz süre bu tarihe eklenir. Tutarlara %20 KDV dahildir.</p><form method="post">${dugmeler}</form>`));
    } catch {
      return sayfaGonder(yanit, 404, abonelikSayfasi("Bağlantı açılamadı", "<p>Firma bulunamadı.</p>", false));
    }
  }

  @Public()
  @Post("baglanti/:anahtar")
  async baglantidanOde(@Param("anahtar") anahtar: string, @Body() govde: unknown, @Req() istek: Request, @Res() yanit: Response) {
    const tenantId = baglantiAnahtariDogrula(anahtar);
    const sure = z.object({ aySayisi: sureSemasi }).safeParse(govde);
    if (!tenantId || !sure.success) return sayfaGonder(yanit, 400, abonelikSayfasi("Ödeme başlatılamadı", "<p>Bağlantı geçersiz ya da süre seçilmedi.</p>", false));
    try {
      const s = await this.odeme.baslat(tenantId, sure.data.aySayisi, "eposta", null, istek.ip);
      return yanit.redirect(303, s.odemeSayfasiUrl);
    } catch (hata) {
      const mesaj = hata instanceof HttpException ? hata.message : "Ödeme sayfası açılamadı";
      return sayfaGonder(yanit, 502, abonelikSayfasi("Ödeme başlatılamadı", `<p>${kacis(mesaj)}</p>`, false));
    }
  }

  @Public()
  @Post("iyzico/callback/:tenantId/:denemeId")
  async iyzicoCallback(
    @Param("tenantId", ParseUUIDPipe) tenantId: string,
    @Param("denemeId", ParseUUIDPipe) denemeId: string,
    @Body() govde: unknown,
    @Res() yanit: Response,
  ) {
    const token = typeof (govde as { token?: unknown })?.token === "string" ? (govde as { token: string }).token : "";
    const panel = `<a class="dugme" href="${kacis(panelAdresi())}">Panele dön</a>`;
    if (!token) return sayfaGonder(yanit, 400, abonelikSayfasi("Ödeme tamamlanamadı", `<p>Ödeme bildirimi eksik.</p>${panel}`, false));
    try {
      const s = await this.odeme.callback(tenantId, denemeId, token);
      const ek = s.tekrar ? "Bu ödeme daha önce kaydedilmişti." : `Ödeme makbuzu e-postanıza gönderildi.${"askiKalkti" in s && s.askiKalkti ? " Aboneliğiniz yeniden etkin." : ""}`;
      return sayfaGonder(yanit, 200, abonelikSayfasi("Ödemeniz alındı", `<p>Yeni dönem sonu: <strong>${gun(s.yeniDonemSonu)}</strong>.</p><p>${ek}</p>${panel}`, true));
    } catch (hata) {
      const durum = hata instanceof HttpException ? hata.getStatus() : 502;
      return sayfaGonder(yanit, durum, abonelikSayfasi("Ödeme tamamlanamadı", `<p>Ödeme doğrulanamadı. Kartınızdan çekim yapıldıysa TekirExtra ekibiyle iletişime geçin.</p>${panel}`, false));
    }
  }
}
