import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam } from "../core/istek-baglami";
import { DestekOturumService } from "../core/destek-oturum.service";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { AuthService } from "./auth.service";
import { DestekOturumundaAcik, IkiAdimKurulumundaAcik, Public } from "./public.decorator";
import { OTURUM_ISARETI_COOKIE, OTURUM_ISARETI_SURESI_SN, oturumIsaretiSirri, oturumIsaretiUret } from "./oturum-isareti";

const girisSemasi = z.object({
  eposta: z.email(),
  parola: z.string().min(1),
  totpKodu: z.string().optional(),
});

export const REFRESH_COOKIE = "tekir_refresh";

function refreshCookieYaz(res: Response, token: string, gecerlilikSonu: Date): void {
  // KLN-22: çerez de oturumun politikadaki bitişinde düşer.
  const kalanMs = Math.max(0, gecerlilikSonu.getTime() - Date.now());
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: kalanMs,
  });
  // Rota koruması: web middleware'i panel sayfalarını bu işaret olmadan sunmaz.
  const sir = oturumIsaretiSirri();
  if (sir) {
    res.cookie(OTURUM_ISARETI_COOKIE, oturumIsaretiUret(sir), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.min(OTURUM_ISARETI_SURESI_SN * 1000, kalanMs),
    });
  }
}

function istemciBilgisi(req: Request) {
  return { ip: req.ip ?? null, tarayici: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Optional() private readonly abonelikErisim?: AbonelikErisimService,
    @Optional() private readonly durum?: KullaniciDurumService,
    @Optional() private readonly destek?: DestekOturumService,
  ) {}

  @Public()
  @Post("giris")
  async giris(
    @Body() govde: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ayristirma = girisSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("E-posta ve parola zorunludur");
    }
    const { eposta, parola, totpKodu } = ayristirma.data;
    const sonuc = await this.auth.giris(eposta, parola, totpKodu, istemciBilgisi(req));
    refreshCookieYaz(res, sonuc.refreshToken, sonuc.gecerlilikSonu);
    return { accessToken: sonuc.accessToken, kullanici: sonuc.kullanici };
  }

  @Public()
  @Post("yenile")
  async yenile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    const sonuc = await this.auth.yenile(token ?? "", istemciBilgisi(req));
    refreshCookieYaz(res, sonuc.refreshToken, sonuc.gecerlilikSonu);
    return { accessToken: sonuc.accessToken, kullanici: sonuc.kullanici };
  }

  @Public()
  @Post("cikis")
  async cikis(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    await this.auth.cikis(token);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    res.clearCookie(OTURUM_ISARETI_COOKIE, { path: "/" });
    return { durum: "ok" };
  }

  @Public()
  @Get("eposta-dogrula")
  async epostaDogrula(@Query("token") token: string) {
    if (!token) throw new BadRequestException("Token gerekli");
    await this.auth.epostaDogrula(token);
    return { durum: "ok", mesaj: "E-posta doğrulandı; artık giriş yapabilirsiniz" };
  }

  @IkiAdimKurulumundaAcik()
  @Get("ben")
  async ben() {
    const { userId, tenantId, rol, destek, ozelRol } = aktifBaglam();
    const [abonelik, durum, politika, destekBagli] = await Promise.all([
      // Platform P0-1: panel salt okunur firmada üstte nedenini gösterir.
      this.abonelikErisim ? this.abonelikErisim.getir(tenantId) : null,
      destek ? undefined : this.durum?.getir(tenantId, userId),
      this.auth.politikaGetir(tenantId),
      // KLN-24: firma kullanıcıları açık destek oturumunu panelde görür.
      this.destek ? this.destek.bagliMi(tenantId) : false,
    ]);
    return {
      userId, tenantId, rol, abonelik,
      // KLN-21: panel kurulum bitene kadar Hesap Güvenliği'ne yönlendirir.
      ikiAdimKurulumuGerekli: Boolean(durum?.ikiAdimEksik),
      // KLN-22: ekran süre dolmadan uyarır, hareketsizken oturumu tazelemez. Destek oturumu kendi süresiyle biter.
      hareketsizlikDk: destek ? null : politika.hareketsizlikDk,
      destekBagli,
      // PLT-10: destek oturumundaki görüntüleyen (salt okunur).
      destek: destek ? { ad: destek.ad } : null,
      // KLN-20: menü özel rolün görüntülemeyi kapattığı modülleri gizler.
      ozelRol: ozelRol ? { id: ozelRol.id, ad: await this.auth.ozelRolAdi(tenantId, ozelRol.id), kapali: ozelRol.kapali } : null,
    };
  }

  /**
   * PLT-10: platformdan açılan destek sekmesi rota koruması işaretini alır;
   * işaret destek oturumunun bitişinde düşer. Yenileme çerezi verilmez.
   */
  @DestekOturumundaAcik()
  @Post("destek/baslat")
  @HttpCode(200)
  destekBaslat(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { destek } = aktifBaglam();
    if (!destek) throw new BadRequestException("Yalnız destek oturumu içindir");
    const sir = oturumIsaretiSirri();
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const exp = Number((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString() || "{}") as { exp?: number }).exp ?? 0);
    const kalanSn = Math.max(0, exp - Math.floor(Date.now() / 1000));
    if (sir && kalanSn > 0) {
      res.cookie(OTURUM_ISARETI_COOKIE, oturumIsaretiUret(sir), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: kalanSn * 1000,
      });
    }
    return { ad: destek.ad, bitis: new Date(exp * 1000) };
  }

  @IkiAdimKurulumundaAcik()
  @Post("totp/kur")
  totpKur() {
    return this.auth.totpKur();
  }

  @IkiAdimKurulumundaAcik()
  @Post("totp/etkinlestir")
  async totpEtkinlestir(@Body() govde: { kod?: string }) {
    if (!govde.kod) throw new BadRequestException("Kod gerekli");
    const { kurtarmaKodlari } = await this.auth.totpEtkinlestir(govde.kod);
    return { durum: "ok", mesaj: "TOTP etkinleştirildi", kurtarmaKodlari };
  }

  /** Yönetim P2-4: açık oturumlar ve kapatma. */
  @IkiAdimKurulumundaAcik()
  @Get("oturumlar")
  oturumlar(@Req() req: Request) {
    return this.auth.oturumlarim((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
  }

  @IkiAdimKurulumundaAcik()
  @Post("oturumlar/digerlerini-kapat")
  @HttpCode(200)
  digerOturumlariKapat(@Req() req: Request) {
    return this.auth.digerOturumlariKapat((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
  }

  @IkiAdimKurulumundaAcik()
  @Post("oturumlar/:id/kapat")
  @HttpCode(200)
  async oturumKapat(@Param("id") id: string) {
    await this.auth.oturumKapat(id);
    return { mesaj: "Oturum kapatıldı" };
  }

  @IkiAdimKurulumundaAcik()
  @Get("totp/durum")
  totpDurum() {
    return this.auth.totpDurum();
  }

  @Post("totp/kapat")
  @HttpCode(200)
  async totpKapat(@Body() govde: { kod?: string }) {
    if (!govde.kod) throw new BadRequestException("Kod gerekli");
    await this.auth.totpKapat(govde.kod);
    return { mesaj: "İki adımlı doğrulama kapatıldı" };
  }

  @Post("totp/kurtarma-kodlari")
  @HttpCode(200)
  kurtarmaKodlariniYenile(@Body() govde: { kod?: string }) {
    if (!govde.kod) throw new BadRequestException("Kod gerekli");
    return this.auth.kurtarmaKodlariniYenile(govde.kod);
  }
}
