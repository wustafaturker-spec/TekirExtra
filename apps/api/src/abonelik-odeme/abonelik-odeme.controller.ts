import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, HttpException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { ABONELIK_SURELERI, tlYaz, type AbonelikSuresi } from "./abonelik-tutari";
import { AbonelikFaturaService } from "./abonelik-fatura.service";
import { AbonelikOdemeService } from "./abonelik-odeme.service";
import { baglantiAnahtariDogrula } from "./baglanti-anahtari";
import { PAYTR_ODEME_ADRESI, type PaytrBildirim } from "./paytr-direkt";

const sureSemasi = z.coerce.number().refine((a): a is AbonelikSuresi => (ABONELIK_SURELERI as readonly number[]).includes(a), "Süre 1, 3, 6 ya da 12 ay olmalı");
const isaret = z.union([z.boolean(), z.literal("1").transform(() => true)]).optional().default(false);

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

/** PLT-13/14: panelden "Şimdi öde" ve kayıtlı kart. Yol /abonelik/ altında olduğu için askıdaki firmada da açıktır. */
@Controller("abonelik/odeme")
@Roller("yonetici")
export class AbonelikOdemeController {
  constructor(
    private readonly odeme: AbonelikOdemeService,
    private readonly fatura: AbonelikFaturaService,
  ) {}

  @Get()
  durum() {
    return this.odeme.durum(aktifBaglam().tenantId);
  }

  @Post()
  baslat(@Body() govde: unknown, @Req() istek: Request) {
    const g = ayristir(z.object({ aySayisi: sureSemasi, kartKaydet: isaret }), govde);
    const { tenantId, userId } = aktifBaglam();
    return this.odeme.baslat(tenantId, g.aySayisi, "panel", userId, istek.ip, g.kartKaydet);
  }

  @Put("otomatik-yenileme")
  otomatikYenileme(@Body() govde: unknown) {
    const g = ayristir(z.object({ acik: z.boolean(), aySayisi: sureSemasi.optional() }), govde);
    return this.odeme.otomatikYenilemeAyarla(aktifBaglam().tenantId, g.acik, g.aySayisi);
  }

  @Delete("kart")
  kartKaldir() {
    return this.odeme.kartKaldir(aktifBaglam().tenantId);
  }

  /** PLT-23: kesinleşmiş abonelik faturasının PDF'i. */
  @Get(":odemeId/fatura.pdf")
  async faturaPdf(@Param("odemeId", ParseUUIDPipe) odemeId: string, @Res() yanit: Response) {
    const pdf = await this.fatura.faturaPdf(aktifBaglam().tenantId, odemeId);
    yanit.setHeader("Content-Type", "application/pdf");
    yanit.setHeader("Content-Disposition", `attachment; filename="${pdf.dosyaAdi}"`);
    yanit.setHeader("Cache-Control", "private, no-store");
    yanit.send(pdf.buffer);
  }
}

const kacis = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const gun = (d: Date | null) => (d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");

/** Sağlayıcı sayfasına giden/dönen kullanıcıya gösterilen sade sayfa (betik yok). */
export function abonelikSayfasi(baslik: string, govde: string, basarili?: boolean, ekBas = ""): string {
  const ikon = basarili === undefined ? "" : `<div class="ikon" style="background:${basarili ? "#15803d" : "#b91c1c"}">${basarili ? "✓" : "!"}</div>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${ekBas}<title>${kacis(baslik)} — TekirExtra</title><style>body{margin:0;background:#f8fafc;color:#172033;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.kart{background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 18px 50px #0f172a14;max-width:560px;margin:16px;padding:36px;text-align:center}.ikon{align-items:center;border-radius:50%;color:#fff;display:inline-flex;font-size:30px;font-weight:700;height:60px;justify-content:center;width:60px}h1{font-size:24px;margin:18px 0 10px}p{color:#5b6475;line-height:1.6;margin:0 0 10px}form{display:grid;gap:10px;margin-top:20px;text-align:left}label{display:grid;gap:4px;font-size:13px;color:#5b6475}label.secim{display:flex;gap:8px;align-items:center}input{border:1px solid #cbd5e1;border-radius:10px;padding:11px 12px;font:15px system-ui}.yan{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}button{border:1px solid #ea580c;border-radius:10px;background:#fff;color:#172033;padding:12px 14px;font:600 15px system-ui;cursor:pointer;display:flex;justify-content:space-between}button.ana{background:#ea580c;color:#fff;justify-content:center}a.dugme{display:inline-block;margin-top:18px;background:#ea580c;color:#fff;border-radius:10px;padding:12px 18px;font-weight:600;text-decoration:none}.kucuk{font-size:12px;color:#7b8493}</style></head><body><main class="kart">${ikon}<h1>${kacis(baslik)}</h1>${govde}<p class="kucuk" style="margin-top:22px">TekirExtra güvenli ödeme · kart bilgileriniz doğrudan ödeme kuruluşuna gönderilir</p></main></body></html>`;
}

function sayfaGonder(yanit: Response, durum: number, html: string) {
  yanit.setHeader("Content-Type", "text/html; charset=utf-8");
  yanit.setHeader("Cache-Control", "no-store");
  yanit.setHeader("Referrer-Policy", "no-referrer");
  // form-action yazılmaz: tarayıcılar onu yönlendirme zincirine de uygular; form
  // gönderimi sağlayıcıya, oradan bankanın 3D sayfasına yönlenir.
  yanit.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return yanit.status(durum).send(html);
}

const panelAdresi = () => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/panel/ayarlar/abonelik`;
const panelDugmesi = () => `<a class="dugme" href="${kacis(panelAdresi())}">Panele dön</a>`;

/** PLT-13/14: oturumsuz uçlar — e-postadaki ödeme bağlantısı, sağlayıcı dönüşleri ve PayTR bildirimi. */
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
      const dugmeler = o.secenekler.map((t) => `<button type="submit" name="aySayisi" value="${t.aySayisi}"><span>${t.aySayisi} ay</span><span>${tlYaz(t.toplam)} TL</span></button>`).join("");
      return sayfaGonder(yanit, 200, abonelikSayfasi("Abonelik ödemesi", `<p><strong>${kacis(o.unvan)}</strong> · ${kacis(o.planAdi)} planı</p><p>Dönem sonu: ${gun(o.donemSonu)}. Seçtiğiniz süre bu tarihe eklenir. Tutarlara %20 KDV dahildir.</p><form method="post"><label class="secim"><input type="checkbox" name="kartKaydet" value="1"> Kartımı ödeme kuruluşunda kaydet, aboneliği otomatik yenile</label>${dugmeler}</form>`));
    } catch {
      return sayfaGonder(yanit, 404, abonelikSayfasi("Bağlantı açılamadı", "<p>Firma bulunamadı.</p>", false));
    }
  }

  @Public()
  @Post("baglanti/:anahtar")
  async baglantidanOde(@Param("anahtar") anahtar: string, @Body() govde: unknown, @Req() istek: Request, @Res() yanit: Response) {
    const tenantId = baglantiAnahtariDogrula(anahtar);
    const g = z.object({ aySayisi: sureSemasi, kartKaydet: isaret }).safeParse(govde);
    if (!tenantId || !g.success) return sayfaGonder(yanit, 400, abonelikSayfasi("Ödeme başlatılamadı", "<p>Bağlantı geçersiz ya da süre seçilmedi.</p>", false));
    try {
      const s = await this.odeme.baslat(tenantId, g.data.aySayisi, "eposta", null, istek.ip, g.data.kartKaydet);
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
    if (!token) return sayfaGonder(yanit, 400, abonelikSayfasi("Ödeme tamamlanamadı", `<p>Ödeme bildirimi eksik.</p>${panelDugmesi()}`, false));
    try {
      const s = await this.odeme.callback(tenantId, denemeId, token);
      return sayfaGonder(yanit, 200, abonelikSayfasi("Ödemeniz alındı", `<p>Yeni dönem sonu: <strong>${gun(s.yeniDonemSonu)}</strong>.</p><p>${basariNotu(s)}</p>${panelDugmesi()}`, true));
    } catch (hata) {
      const durum = hata instanceof HttpException ? hata.getStatus() : 502;
      return sayfaGonder(yanit, durum, abonelikSayfasi("Ödeme tamamlanamadı", `<p>Ödeme doğrulanamadı. Kartınızdan çekim yapıldıysa TekirExtra ekibiyle iletişime geçin.</p>${panelDugmesi()}`, false));
    }
  }

  /** PayTR Direkt API kart formu: kart alanları tarayıcıdan doğrudan PayTR'a gönderilir. */
  @Public()
  @Get("paytr/form/:tenantId/:denemeId")
  async paytrForm(
    @Param("tenantId", ParseUUIDPipe) tenantId: string,
    @Param("denemeId", ParseUUIDPipe) denemeId: string,
    @Query("t") token: string,
    @Req() istek: Request,
    @Res() yanit: Response,
  ) {
    try {
      const f = await this.odeme.paytrForm(tenantId, denemeId, String(token ?? ""), istek.ip ?? "127.0.0.1");
      if (!f.alanlar) return sayfaGonder(yanit, 200, abonelikSayfasi(f.durum === "odendi" ? "Bu ödeme tamamlandı" : "Bu ödeme girişimi kapandı", `<p>Yeniden ödemek için panelden yeni ödeme başlatın.</p>${panelDugmesi()}`, f.durum === "odendi"));
      const gizli = Object.entries(f.alanlar).map(([k, v]) => `<input type="hidden" name="${kacis(k)}" value="${kacis(v)}">`).join("");
      const yil = new Date().getFullYear() % 100;
      return sayfaGonder(yanit, 200, abonelikSayfasi("Kartla öde", `<p><strong>${kacis(f.firmaUnvani ?? "")}</strong> · ${kacis(f.aciklama ?? "")}</p><p>Toplam <strong>${tlYaz(Number(f.toplam))} TL</strong> (KDV dahil)${f.kartKaydet ? " · kartınız PayTR'da kaydedilir, abonelik otomatik yenilenir" : ""}${f.testOrtami ? " · <strong>test ortamı</strong>" : ""}</p>
<form method="post" action="${PAYTR_ODEME_ADRESI}">${gizli}
<label>Kart üzerindeki ad<input name="cc_owner" autocomplete="cc-name" required maxlength="50"></label>
<label>Kart numarası<input name="card_number" autocomplete="cc-number" inputmode="numeric" required pattern="[0-9 ]{12,19}" maxlength="19"></label>
<div class="yan"><label>Ay<input name="expiry_month" autocomplete="cc-exp-month" inputmode="numeric" required pattern="(0?[1-9]|1[0-2])" maxlength="2" placeholder="AA"></label><label>Yıl<input name="expiry_year" autocomplete="cc-exp-year" inputmode="numeric" required pattern="[0-9]{2}" maxlength="2" placeholder="${yil}"></label><label>CVV<input name="cvv" autocomplete="cc-csc" inputmode="numeric" required pattern="[0-9]{3,4}" maxlength="4"></label></div>
<button type="submit" class="ana">${tlYaz(Number(f.toplam))} TL öde</button></form>`));
    } catch (hata) {
      const durum = hata instanceof HttpException ? hata.getStatus() : 502;
      return sayfaGonder(yanit, durum, abonelikSayfasi("Ödeme sayfası açılamadı", `<p>Bağlantı geçersiz ya da süresi dolmuş.</p>${panelDugmesi()}`, false));
    }
  }

  /** PayTR dönüşü: kesin sonuç bildirimle gelir; henüz gelmediyse sayfa kendini yeniler. */
  @Public()
  @Get("paytr/sonuc/:tenantId/:denemeId")
  async paytrSonuc(
    @Param("tenantId", ParseUUIDPipe) tenantId: string,
    @Param("denemeId", ParseUUIDPipe) denemeId: string,
    @Query("t") token: string,
    @Query("hata") hataIsareti: string | undefined,
    @Res() yanit: Response,
  ) {
    try {
      const s = await this.odeme.paytrSonuc(tenantId, denemeId, String(token ?? ""));
      if (s.durum === "odendi") return sayfaGonder(yanit, 200, abonelikSayfasi("Ödemeniz alındı", `<p>Yeni dönem sonu: <strong>${gun(s.yeniDonemSonu)}</strong>.</p><p>Ödeme makbuzu e-postanıza gönderildi.</p>${panelDugmesi()}`, true));
      if (s.durum === "basarisiz" || hataIsareti) return sayfaGonder(yanit, 200, abonelikSayfasi("Ödeme tamamlanamadı", `<p>${kacis(s.hata ?? "Ödeme onaylanmadı.")}</p><p>Panelden yeniden deneyebilirsiniz.</p>${panelDugmesi()}`, false));
      return sayfaGonder(yanit, 200, abonelikSayfasi("Ödemeniz işleniyor", `<p>PayTR sonucu birkaç saniye içinde bildirir; bu sayfa kendiliğinden yenilenir.</p>${panelDugmesi()}`, undefined, '<meta http-equiv="refresh" content="5">'));
    } catch {
      return sayfaGonder(yanit, 400, abonelikSayfasi("Ödeme bulunamadı", `<p>Bağlantı geçersiz.</p>${panelDugmesi()}`, false));
    }
  }

  /** PayTR mağaza panelindeki "Bildirim URL" bu uçtur; yanıt düz metin "OK" olmalıdır. */
  @Public()
  @Post("paytr/bildirim")
  @HttpCode(200)
  @Header("Content-Type", "text/plain")
  async paytrBildirim(@Body() govde: PaytrBildirim) {
    await this.odeme.paytrBildirim(govde);
    return "OK";
  }
}

function basariNotu(s: { tekrar: boolean; askiKalkti?: boolean; kartKaydedildi?: boolean }) {
  if (s.tekrar) return "Bu ödeme daha önce kaydedilmişti.";
  return ["Ödeme makbuzu e-postanıza gönderildi.", s.askiKalkti ? "Aboneliğiniz yeniden etkin." : "", s.kartKaydedildi ? "Kartınız kaydedildi; abonelik otomatik yenilenecek." : ""].filter(Boolean).join(" ");
}
