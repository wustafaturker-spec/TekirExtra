import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { PLATFORM_ERISIM_COOKIE, PLATFORM_ERISIM_SURESI_MS, erisimCereziSil, erisimCereziYaz, girisYaniti, istekTokeni } from "../auth/erisim-cerezi";
import { z } from "zod";
import { MEVZUAT_TURLERI, takvimGunuMu } from "@tekirextra/shared";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformRolleri, PlatformUcu, Public } from "../auth/public.decorator";
import { oturumIsaretiSirri, oturumIsaretiUret, PLATFORM_OTURUM_ISARETI_COOKIE, PLATFORM_OTURUM_ISARETI_SURESI_SN } from "../auth/oturum-isareti";
import { KABUL_SONUC_ALANLARI, kabulSenaryolariSemasi } from "./bordro-kabul";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMevzuatService } from "./platform-mevzuat.service";
import { PlatformAiTavanService } from "./platform-ai-tavan.service";
import { ODEME_SURELERI, PlatformFirmaService } from "./platform-firma.service";
import { PlatformKullanicilarService } from "./platform-kullanicilar.service";
import { firmaFiltreSemasi } from "./platform-firma-filtre";

const tarih = z.string().refine(takvimGunuMu, "Tarih YYYY-MM-DD biçiminde geçerli bir takvim günü olmalıdır");
const degisiklikSemasi = z.object({
  baslik: z.string().trim().min(3, "Başlık en az 3 karakter").max(200),
  dayanak: z.string().trim().min(5, "Mevzuat dayanağı zorunludur (tebliğ/kılavuz adı, sayısı, tarihi)").max(500),
  aciklama: z.string().trim().max(2000).optional().nullable(),
  yururlukBaslangic: tarih,
});
const satirlarSemasi = z.object({
  satirlar: z.array(z.object({
    tur: z.enum(MEVZUAT_TURLERI),
    anahtar: z.string().trim().min(1).max(40),
    islem: z.enum(["ekle", "degistir", "kaldir"]),
    deger: z.unknown().optional(),
  })).max(500),
});
/** PLT-28: değişikliğe yazan her istek okuduğu sürümü gönderir; eskisiyse 409. */
const surum = z.coerce.number({ message: "Değişiklik sürümü eksik; sayfayı yenileyin" }).int().positive("Değişiklik sürümü eksik; sayfayı yenileyin");
const surumSemasi = z.object({ surum });
const girisSemasi = z.object({ eposta: z.string().email(), parola: z.string().min(1), totpKodu: z.string().regex(/^\d{6}$/, "Doğrulama kodu 6 hane olmalıdır") });
const talepSemasi = z.object({ durum: z.enum(["acik", "cozuldu", "reddedildi"]), cozumNotu: z.string().trim().max(2000).optional().nullable() });

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
  return sonuc.data;
}

const davetAnahtariSemasi = z.object({ anahtar: z.string().min(20).max(200) });
const davetTamamlaSemasi = davetAnahtariSemasi.extend({ parola: z.string().min(1).max(200), kod: z.string().regex(/^\d{6}$/, "Doğrulama kodu 6 hane olmalıdır") });

/** MVZ-04: platform ekibi girişi; kiracı oturumundan ayrıdır. */
@Controller("platform/auth")
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly kullanicilar: PlatformKullanicilarService,
  ) {}

  /** PLT-07: davet / 2FA yeniden kurulum bağlantısı; anahtar URL yerine gövdede gelir (erişim kaydına düşmez). */
  @Public()
  @Post("davet/bilgi")
  @HttpCode(200)
  davetBilgisi(@Body() govde: unknown) {
    return this.kullanicilar.davetBilgisi(ayristir(davetAnahtariSemasi, govde).anahtar);
  }

  @Public()
  @Post("davet/tamamla")
  @HttpCode(200)
  async davetTamamla(@Body() govde: unknown, @Ip() ip: string) {
    const g = ayristir(davetTamamlaSemasi, govde);
    return this.kullanicilar.davetTamamla(g.anahtar, { parola: g.parola, kod: g.kod }, ip);
  }

  @Public()
  @Post("giris")
  async giris(@Body() govde: unknown, @Req() istek: Request, @Res({ passthrough: true }) res: Response) {
    const { eposta, parola, totpKodu } = ayristir(girisSemasi, govde);
    const sonuc = await this.auth.giris(eposta, parola, totpKodu);
    // PLT-08: web middleware'i /platform sayfalarını bu işaret olmadan sunmaz.
    const sir = oturumIsaretiSirri();
    if (sir) {
      res.cookie(PLATFORM_OTURUM_ISARETI_COOKIE, oturumIsaretiUret(sir, undefined, "p1"), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: PLATFORM_OTURUM_ISARETI_SURESI_SN * 1000,
      });
    }
    erisimCereziYaz(res, PLATFORM_ERISIM_COOKIE, sonuc.accessToken, PLATFORM_ERISIM_SURESI_MS);
    return girisYaniti(istek, sonuc);
  }

  /** PLT-25: oturum sunucuda iptal edilir; token bozuk ya da süresi dolmuşsa yalnız rota işareti silinir. */
  @Public()
  @Post("cikis")
  @HttpCode(200)
  async cikis(@Req() istek: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(PLATFORM_OTURUM_ISARETI_COOKIE, { path: "/" });
    erisimCereziSil(res, PLATFORM_ERISIM_COOKIE);
    return { sunucudaIptal: await this.auth.cikis(istekTokeni(istek, true).token) };
  }

  /** PLT-25: kullanıcının tüm platform oturumları kapanır (bu sekme dahil). */
  @PlatformUcu()
  @PlatformRolleri("yonetici", "mevzuat_editoru")
  @Post("oturumlari-kapat")
  @HttpCode(200)
  async oturumlariKapat(@Res({ passthrough: true }) res: Response) {
    const sonuc = await this.auth.tumOturumlariKapat();
    res.clearCookie(PLATFORM_OTURUM_ISARETI_COOKIE, { path: "/" });
    erisimCereziSil(res, PLATFORM_ERISIM_COOKIE);
    return sonuc;
  }

  @PlatformUcu()
  @PlatformRolleri("yonetici", "mevzuat_editoru")
  @Get("ben")
  ben() {
    return aktifPlatformBaglam();
  }
}

/** MVZ-05…08: Mevzuat Merkezi yönetimi (yalnız platform token'ı). PLT-06: editör de çalışır; dört göz kuralı sürer. */
@PlatformUcu()
@PlatformRolleri("yonetici", "mevzuat_editoru")
@Controller("platform/mevzuat")
export class PlatformMevzuatController {
  constructor(private readonly mevzuat: PlatformMevzuatService) {}

  @Get("degisiklikler")
  listele(@Query("durum") durum?: string) {
    const d = durum ? ayristir(z.enum(["taslak", "onay_bekliyor", "yayinlandi"]), durum) : undefined;
    return this.mevzuat.listele(d);
  }

  @Post("degisiklikler")
  olustur(@Body() govde: unknown) {
    return this.mevzuat.olustur(ayristir(degisiklikSemasi, govde));
  }

  @Get("degisiklikler/:id")
  getir(@Param("id", ParseUUIDPipe) id: string) {
    return this.mevzuat.getir(id);
  }

  @Patch("degisiklikler/:id")
  async guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { surum: s, ...g } = ayristir(degisiklikSemasi.extend({ surum }), govde);
    await this.mevzuat.guncelle(id, g, s);
    return this.mevzuat.getir(id);
  }

  @Delete("degisiklikler/:id")
  async sil(@Param("id", ParseUUIDPipe) id: string, @Query("surum") s?: string) {
    await this.mevzuat.sil(id, ayristir(surum, s));
    return { durum: "ok" };
  }

  @Put("degisiklikler/:id/satirlar")
  async satirlar(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = ayristir(satirlarSemasi.extend({ surum }), govde);
    await this.mevzuat.satirlariYaz(id, g.satirlar, g.surum);
    return this.mevzuat.getir(id);
  }

  /** MVZ-14: bordro parametresi değişikliğinin kabul senaryoları. */
  @Put("degisiklikler/:id/kabul-senaryolari")
  async kabulSenaryolari(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const g = ayristir(kabulSenaryolariSemasi.extend({ surum }), govde);
    await this.mevzuat.kabulSenaryolariYaz(id, g.senaryolar, g.surum);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/kabul-senaryolari/calistir")
  async kabulCalistir(@Param("id", ParseUUIDPipe) id: string) {
    await this.mevzuat.kabulSenaryolariCalistir(id);
    return this.mevzuat.getir(id);
  }

  @Get("kabul-sonuc-alanlari")
  kabulSonucAlanlari() {
    return KABUL_SONUC_ALANLARI;
  }

  @Post("degisiklikler/:id/onaya-gonder")
  async onayaGonder(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    await this.mevzuat.onayaGonder(id, ayristir(surumSemasi, govde).surum);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/taslaga-cek")
  async taslagaCek(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    await this.mevzuat.taslagaCek(id, ayristir(surumSemasi, govde).surum);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/geri-cevir")
  async geriCevir(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { gerekce, surum: s } = ayristir(z.object({ gerekce: z.string().trim().min(5, "Geri çevirme gerekçesi zorunludur").max(2000), surum }), govde);
    await this.mevzuat.geriCevir(id, gerekce, s);
    return this.mevzuat.getir(id);
  }

  @Post("degisiklikler/:id/yayinla")
  async yayinla(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const sonuc = await this.mevzuat.yayinla(id, ayristir(surumSemasi, govde).surum);
    return { ...sonuc, degisiklik: await this.mevzuat.getir(id) };
  }

  @Get("kayitlar")
  kayitlar(@Query("tur") tur: string, @Query("tarih") tarihDegeri?: string, @Query("anahtar") anahtar?: string) {
    return this.mevzuat.kayitlar(ayristir(z.enum(MEVZUAT_TURLERI), tur), tarihDegeri ? ayristir(tarih, tarihDegeri) : undefined, anahtar || undefined);
  }

  @Get("olaylar")
  olaylar(@Query("sayfa") sayfa?: string) {
    return this.mevzuat.olaylar(Number(sayfa) || 1, aktifPlatformBaglam().rol === "mevzuat_editoru");
  }

  /** MVZ-17: dönemsel değerlerin (bordro, kıdem tavanı, tevkifat alt sınırı) yayın takvimi. */
  @Get("yayin-takvimi")
  yayinTakvimi() {
    return this.mevzuat.yayinTakvimi();
  }

  @Get("talepler")
  talepler(@Query("durum") durum?: string) {
    return this.mevzuat.talepler(durum ? ayristir(z.enum(["acik", "cozuldu", "reddedildi"]), durum) : undefined);
  }

  @Patch("talepler/:id")
  async talepGuncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { durum, cozumNotu } = ayristir(talepSemasi, govde);
    await this.mevzuat.talepGuncelle(id, durum, cozumNotu);
    return { durum: "ok" };
  }
}

const tavanSemasi = z.object({ aylikTavanUsd: z.number().min(0, "Tavan negatif olamaz").max(1_000_000, "Tavan en çok 1.000.000 USD").nullable() });

/** AI-31: platform anahtarıyla çalışan kiracıların aylık yapay zekâ tavanı. */
@PlatformUcu()
@Controller("platform/ai")
export class PlatformAiController {
  constructor(private readonly tavan: PlatformAiTavanService) {}

  @Get("kiracilar")
  listele() {
    return this.tavan.listele();
  }

  @Put("kiracilar/:tenantId/tavan")
  tavanYaz(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    return this.tavan.tavanYaz(tenantId, ayristir(tavanSemasi, govde).aylikTavanUsd);
  }
}

const durumSemasi = z.object({ durum: z.enum(["askida", "aktif"]), neden: z.string().trim().min(5, "Neden en az 5 karakter").max(500), askiNedeni: z.enum(["odeme", "diger"]).optional() });
const planSemasi = z.object({ planKodu: z.string().min(1).max(40), neden: z.string().trim().min(5, "Neden en az 5 karakter").max(500) });
const kararSemasi = z.object({ onay: z.boolean(), not: z.string().trim().max(500).optional().nullable() });
const odemeSemasi = z.object({
  aySayisi: z.union(ODEME_SURELERI.map((a) => z.literal(a)) as [z.ZodLiteral<1>, z.ZodLiteral<3>, z.ZodLiteral<6>, z.ZodLiteral<12>], { message: "Süre 1, 3, 6 ya da 12 ay olmalı" }),
  // PLT-27: tutar kuruş hassasiyetinde; kayan nokta hesabına bırakılmaz, metin olarak veritabanına gider.
  tutar: z.union([z.number(), z.string().trim()], { message: "Tutar girin" })
    .transform((v) => String(v))
    .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), "Tutar en fazla 2 ondalıklı, eksi olmayan bir sayı olmalı")
    .refine((v) => Number(v) <= 10_000_000, "Tutar en fazla 10.000.000 olabilir"),
  not: z.string().trim().max(500).optional().nullable(),
  /** PLT-27: istemcinin bu ödeme formu için ürettiği kimlik; yeniden denemede aynısı gönderilir. */
  islemAnahtari: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, "İşlem anahtarı eksik ya da geçersiz"),
});

/** Platform P0-1 / P1-1: firma genel bakışı ve abonelik yönetimi. */
@PlatformUcu()
@Controller("platform/firmalar")
export class PlatformFirmaController {
  constructor(private readonly firmalar: PlatformFirmaService) {}

  @Get()
  listele() {
    return this.firmalar.listele();
  }

  @Get("sayfali")
  sayfali(@Query() sorgu: unknown) {
    return this.firmalar.sayfali(ayristir(firmaFiltreSemasi, sorgu));
  }

  @Get(":tenantId/gecmis")
  gecmis(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    return this.firmalar.gecmis(tenantId);
  }

  @Post(":tenantId/durum")
  durum(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    const g = ayristir(durumSemasi, govde);
    return this.firmalar.durumDegistir(tenantId, g.durum, g.neden, g.askiNedeni);
  }

  @Post(":tenantId/plan")
  plan(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    const g = ayristir(planSemasi, govde);
    return this.firmalar.planDegistir(tenantId, g.planKodu, g.neden);
  }

  /** PLT-09: elle tahsilat; dönem uzar, durum değişmez. */
  @Post(":tenantId/odeme")
  odeme(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Body() govde: unknown) {
    const g = ayristir(odemeSemasi, govde);
    return this.firmalar.odemeKaydet(tenantId, g.aySayisi, g.tutar, g.not || null, g.islemAnahtari);
  }

  /** PLT-10: izinli firmada salt okunur destek oturumu. */
  @Post(":tenantId/destek-oturumu")
  destekOturumuAc(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    return this.firmalar.destekOturumuAc(tenantId);
  }

  @Post("destek-oturumlari/:oturumId/kapat")
  @HttpCode(200)
  destekOturumuKapat(@Param("oturumId", ParseUUIDPipe) oturumId: string) {
    return this.firmalar.destekOturumuKapat(oturumId);
  }

  @Post("talepler/:talepId/karar")
  karar(@Param("talepId", ParseUUIDPipe) talepId: string, @Body() govde: unknown) {
    const g = ayristir(kararSemasi, govde);
    return this.firmalar.talepKarar(talepId, g.onay, g.not ?? null);
  }
}

const platformKullaniciSemasi = z.object({
  eposta: z.email("Geçerli bir e-posta girin"),
  adSoyad: z.string().trim().min(2, "Ad soyad en az 2 karakter").max(120),
  rol: z.enum(["yonetici", "mevzuat_editoru"]),
});
const platformKullaniciGuncelleSemasi = z.object({ rol: z.enum(["yonetici", "mevzuat_editoru"]).optional(), aktif: z.boolean().optional(), gorevAktarimHedefiId: z.uuid().optional() });

/** PLT-07: platform kullanıcıları — yalnız platform yöneticisi. */
@PlatformUcu()
@Controller("platform/kullanicilar")
export class PlatformKullanicilarController {
  constructor(private readonly kullanicilar: PlatformKullanicilarService) {}

  @Get()
  listele() {
    return this.kullanicilar.listele();
  }

  @Post()
  olustur(@Body() govde: unknown) {
    return this.kullanicilar.olustur(ayristir(platformKullaniciSemasi, govde));
  }

  @Patch(":id")
  guncelle(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    return this.kullanicilar.guncelle(id, ayristir(platformKullaniciGuncelleSemasi, govde));
  }

  @Post(":id/davet")
  @HttpCode(200)
  davetYenile(@Param("id", ParseUUIDPipe) id: string) {
    return this.kullanicilar.davetYenile(id);
  }

  @Post(":id/iki-adim-sifirla")
  @HttpCode(200)
  ikiAdimSifirla(@Param("id", ParseUUIDPipe) id: string) {
    return this.kullanicilar.ikiAdimSifirla(id);
  }
}
