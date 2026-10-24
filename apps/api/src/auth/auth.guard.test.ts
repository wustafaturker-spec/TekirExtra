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

describe("kullanıcı durumu denetimi (yönetim P1-2)", () => {
  const jwt = new JwtService({ secret: KIRACI });
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  let db: { aktif: boolean; rol: string; oturumSurumu: number };
  let okuma: number;
  // Gerçek önbellekli servis, sahte Prisma üstünde.
  const kurGuard = async () => {
    const { KullaniciDurumService } = await import("../core/kullanici-durum.service");
    const prisma = { tenantIslem: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ user: { findUnique: async () => { okuma++; return { ...db }; } } }) };
    return new AuthGuard(jwt, reflector, new KullaniciDurumService(prisma as never));
  };
  const dene = (guard: AuthGuard, token: string) => {
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never;
    return istekBaglami.run({}, () => guard.canActivate(context));
  };
  const token = (yuk: Record<string, unknown>) => jwt.signAsync({ sub: "u1", tenantId: "t1", rol: "muhasebe", ...yuk });

  beforeEach(() => { process.env.JWT_SECRET = KIRACI; db = { aktif: true, rol: "muhasebe", oturumSurumu: 0 }; okuma = 0; });

  it("güncel token geçer; ardışık isteklerde DB'ye gidilmez", async () => {
    const guard = await kurGuard();
    const t = await token({ sv: 0 });
    await expect(dene(guard, t)).resolves.toBe(true);
    await expect(dene(guard, t)).resolves.toBe(true);
    expect(okuma).toBe(1);
  });

  it("sürüm alanı olmayan eski token sürüm 0 sayılır", async () => {
    await expect(dene(await kurGuard(), await token({}))).resolves.toBe(true);
  });

  it("pasife alınan, rolü değişen ya da sürümü artan kullanıcının token'ı reddedilir", async () => {
    for (const degisiklik of [{ aktif: false }, { rol: "satis" }, { oturumSurumu: 1 }]) {
      db = { aktif: true, rol: "muhasebe", oturumSurumu: 0, ...degisiklik };
      await expect(dene(await kurGuard(), await token({ sv: 0 }))).rejects.toThrow(/güncel değil/);
    }
  });

  it("önbellek bayatken yeni sürümlü token bir kez taze okumayla geçer, eski token düşer", async () => {
    const guard = await kurGuard();
    await expect(dene(guard, await token({ sv: 0 }))).resolves.toBe(true);
    db.oturumSurumu = 1; // parola değişti; bu süreçte önbellek hâlâ 0 diyor
    await expect(dene(guard, await token({ sv: 1 }))).resolves.toBe(true);
    await expect(dene(guard, await token({ sv: 0 }))).rejects.toThrow(/güncel değil/);
  });
});
