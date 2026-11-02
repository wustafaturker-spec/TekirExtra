import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * SEC-16: tarayıcıda erişim token'ı HttpOnly çerezdedir, betikler okuyamaz. Bearer
 * başlığı önceliklidir: destek sekmesi ve dış istemciler onu kullanır, CSRF yüzeyi
 * yoktur. Yol `/api/v1`: firma ve platform çerezi ayrıdır, guard uca göre seçer.
 */
export const ERISIM_COOKIE = "tekir_access";
export const PLATFORM_ERISIM_COOKIE = "tekir_platform_access";
export const ERISIM_SURESI_MS = 15 * 60_000;
export const PLATFORM_ERISIM_SURESI_MS = 30 * 60_000;
export const CSRF_BASLIGI = "x-tekir-istek";

const COOKIE_YOLU = "/api/v1";

export function erisimCereziYaz(res: Response, ad: string, token: string, sureMs: number): void {
  res.cookie(ad, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_YOLU,
    maxAge: sureMs,
  });
}

export function erisimCereziSil(res: Response, ad: string): void {
  res.clearCookie(ad, { path: COOKIE_YOLU });
}

export function istekTokeni(istek: Request, platformUcu: boolean): { token: string | undefined; cerezden: boolean } {
  const baslik = istek.headers.authorization?.replace(/^Bearer /, "");
  if (baslik) return { token: baslik, cerezden: false };
  const cerezler = (istek.cookies ?? {}) as Record<string, string | undefined>;
  const token = cerezler[platformUcu ? PLATFORM_ERISIM_COOKIE : ERISIM_COOKIE];
  return { token, cerezden: Boolean(token) };
}

/**
 * Çerez tarayıcıda kendiliğinden gider; yazma isteği uygulamanın kendi istemcisinden
 * gelmelidir. Başka site özel başlığı gönderemez (CORS yalnız APP_URL'e açık).
 */
export function csrfDenetle(istek: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(istek.method)) return;
  if (istek.headers[CSRF_BASLIGI] !== "1" || istek.headers["sec-fetch-site"] === "cross-site") {
    throw new ForbiddenException("İstek kaynağı doğrulanamadı; sayfayı yenileyip tekrar deneyin");
  }
}
