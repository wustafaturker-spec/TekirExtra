import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AuthGuard } from "./auth.guard";
import { PLATFORM_ANAHTAR } from "./public.decorator";
import { aktifPlatformBaglam, baglamAl, istekBaglami } from "../core/istek-baglami";

const KIRACI = "kiraci-anahtari";
const PLATFORM = "platform-anahtari";

function kur(platformUcu: boolean, token: string) {
  const reflector = { getAllAndOverride: (anahtar: string) => (anahtar === PLATFORM_ANAHTAR ? platformUcu : false) } as unknown as Reflector;
  const guard = new AuthGuard(new JwtService({ secret: KIRACI }), reflector);
  const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never;
  return () => istekBaglami.run({}, async () => ({ sonuc: await guard.canActivate(context), kiraci: baglamAl(), platform: (() => { try { return aktifPlatformBaglam(); } catch { return undefined; } })() }));
}

describe("platform ve kiracı token ayrımı (MVZ-04)", () => {
  const jwt = new JwtService({});
  let kiraciToken: string, platformToken: string;
  beforeEach(async () => {
    process.env.JWT_SECRET = KIRACI;
    process.env.PLATFORM_JWT_SECRET = PLATFORM;
    kiraciToken = await jwt.signAsync({ sub: "u1", tenantId: "t1", rol: "yonetici" }, { secret: KIRACI });
    platformToken = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform" }, { secret: PLATFORM });
  });
  afterEach(() => { delete process.env.PLATFORM_JWT_SECRET; });

  it("platform token'ı platform ucunda platform kimliği kurar, kiracı bağlamı kurmaz", async () => {
    const r = await kur(true, platformToken)();
    expect(r).toMatchObject({ sonuc: true, kiraci: undefined, platform: { kullaniciId: "p1", eposta: "p@x.io" } });
  });

  it("kiracı token'ı platform ucunda reddedilir", async () => {
    await expect(kur(true, kiraciToken)()).rejects.toThrow(UnauthorizedException);
  });

  it("platform token'ı kiracı ucunda reddedilir", async () => {
    await expect(kur(false, platformToken)()).rejects.toThrow(UnauthorizedException);
  });

  it("kiracı anahtarıyla imzalanmış 'platform' kapsamlı token iki tarafta da geçmez", async () => {
    const sahte = await jwt.signAsync({ sub: "u1", tenantId: "t1", rol: "yonetici", kapsam: "platform" }, { secret: KIRACI });
    await expect(kur(false, sahte)()).rejects.toThrow(UnauthorizedException);
    await expect(kur(true, sahte)()).rejects.toThrow(UnauthorizedException);
  });

  it("platform anahtarı yoksa ya da kiracı anahtarıyla aynıysa platform uçları kapalıdır", async () => {
    process.env.PLATFORM_JWT_SECRET = KIRACI;
    const ayni = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform" }, { secret: KIRACI });
    await expect(kur(true, ayni)()).rejects.toThrow(/yapılandırılmamış/);
    delete process.env.PLATFORM_JWT_SECRET;
    await expect(kur(true, platformToken)()).rejects.toThrow(/yapılandırılmamış/);
  });

  it("kiracı token'ı kiracı ucunda kiracı bağlamı kurar", async () => {
    const r = await kur(false, kiraciToken)();
    expect(r).toMatchObject({ sonuc: true, kiraci: { tenantId: "t1", userId: "u1", rol: "yonetici" }, platform: undefined });
  });
});
