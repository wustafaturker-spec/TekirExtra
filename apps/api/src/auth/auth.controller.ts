import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";
import { OTURUM_ISARETI_COOKIE, OTURUM_ISARETI_SURESI_SN, oturumIsaretiSirri, oturumIsaretiUret } from "./oturum-isareti";

const girisSemasi = z.object({
  eposta: z.email(),
  parola: z.string().min(1),
  totpKodu: z.string().optional(),
});

const REFRESH_COOKIE = "tekir_refresh";

function refreshCookieYaz(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  // Rota koruması: web middleware'i panel sayfalarını bu işaret olmadan sunmaz.
  const sir = oturumIsaretiSirri();
  if (sir) {
    res.cookie(OTURUM_ISARETI_COOKIE, oturumIsaretiUret(sir), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: OTURUM_ISARETI_SURESI_SN * 1000,
    });
  }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("giris")
  async giris(
    @Body() govde: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ayristirma = girisSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException("E-posta ve parola zorunludur");
    }
    const { eposta, parola, totpKodu } = ayristirma.data;
    const sonuc = await this.auth.giris(eposta, parola, totpKodu);
    refreshCookieYaz(res, sonuc.refreshToken);
    return { accessToken: sonuc.accessToken, kullanici: sonuc.kullanici };
  }

  @Public()
  @Post("yenile")
  async yenile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    const sonuc = await this.auth.yenile(token ?? "");
    refreshCookieYaz(res, sonuc.refreshToken);
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

  @Get("ben")
  ben() {
    const { userId, tenantId, rol } = aktifBaglam();
    return { userId, tenantId, rol };
  }

  @Post("totp/kur")
  totpKur() {
    return this.auth.totpKur();
  }

  @Post("totp/etkinlestir")
  async totpEtkinlestir(@Body() govde: { kod?: string }) {
    if (!govde.kod) throw new BadRequestException("Kod gerekli");
    await this.auth.totpEtkinlestir(govde.kod);
    return { durum: "ok", mesaj: "TOTP etkinleştirildi" };
  }
}
