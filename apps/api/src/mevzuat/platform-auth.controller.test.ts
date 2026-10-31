import { afterEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { oturumIsaretiGecerli, PLATFORM_OTURUM_ISARETI_COOKIE } from "../auth/oturum-isareti";
import { PlatformAuthController } from "./platform.controller";
import type { PlatformAuthService } from "./platform-auth.service";

const SIR = "s".repeat(40);
const sahteYanit = () => ({ cookie: vi.fn(), clearCookie: vi.fn() });

describe("platform girişi rota koruması işareti (PLT-08)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("başarılı girişte 30 dk'lık platform işaretini çerez olarak koyar", async () => {
    vi.stubEnv("OTURUM_ISARETI_SECRET", SIR);
    const auth = { giris: vi.fn().mockResolvedValue({ accessToken: "t" }) } as unknown as PlatformAuthService;
    const res = sahteYanit();
    expect(await new PlatformAuthController(auth).giris({ eposta: "ekip@tekirextra.com", parola: "x", totpKodu: "123456" }, res as unknown as Response)).toEqual({ accessToken: "t" });
    const [ad, deger, secenek] = res.cookie.mock.calls[0] as [string, string, { maxAge: number; httpOnly: boolean; path: string }];
    expect(ad).toBe(PLATFORM_OTURUM_ISARETI_COOKIE);
    expect(oturumIsaretiGecerli(deger, SIR, undefined, "p1")).toBe(true);
    expect(oturumIsaretiGecerli(deger, SIR)).toBe(false);
    expect(secenek).toMatchObject({ maxAge: 30 * 60 * 1000, httpOnly: true, path: "/" });
  });

  it("giriş başarısızsa çerez konmaz; çıkış çerezi siler", async () => {
    vi.stubEnv("OTURUM_ISARETI_SECRET", SIR);
    const cikis = vi.fn().mockResolvedValue(true);
    const auth = { giris: vi.fn().mockRejectedValue(new Error("Geçersiz")), cikis } as unknown as PlatformAuthService;
    const res = sahteYanit();
    const denetleyici = new PlatformAuthController(auth);
    await expect(denetleyici.giris({ eposta: "ekip@tekirextra.com", parola: "x", totpKodu: "123456" }, res as unknown as Response)).rejects.toThrow("Geçersiz");
    expect(res.cookie).not.toHaveBeenCalled();
    // PLT-25: çıkış token'ı sunucuda iptal ettirir ve sonucu bildirir.
    expect(await denetleyici.cikis("Bearer abc", res as unknown as Response)).toEqual({ sunucudaIptal: true });
    expect(cikis).toHaveBeenCalledWith("abc");
    expect(res.clearCookie).toHaveBeenCalledWith(PLATFORM_OTURUM_ISARETI_COOKIE, { path: "/" });
  });
});
