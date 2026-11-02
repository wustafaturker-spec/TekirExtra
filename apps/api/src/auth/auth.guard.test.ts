import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AuthGuard } from "./auth.guard";
import { girisYaniti } from "./erisim-cerezi";
import { PLATFORM_ANAHTAR, PLATFORM_ROLLER_ANAHTAR } from "./public.decorator";
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
    const prisma = { tenantIslem: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ user: { findUnique: async () => { okuma++; return { ...db }; } }, tenant: { findUnique: async () => null } }) };
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

describe("platform rolleri (PLT-06)", () => {
  const jwt = new JwtService({});
  let platformToken: string;
  beforeEach(async () => {
    process.env.JWT_SECRET = KIRACI;
    process.env.PLATFORM_JWT_SECRET = PLATFORM;
    platformToken = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform", sv: 0, oid: "o1" }, { secret: PLATFORM });
  });
  afterEach(() => { delete process.env.PLATFORM_JWT_SECRET; });

  const kurRollu = (token: string, roller: string[] | undefined, db?: { rol: string; aktif: boolean; oturumSurumu?: number }, oturum = { kullaniciId: "p1", iptalAt: null as Date | null, bitis: new Date(Date.now() + 60_000) }) => {
    const reflector = { getAllAndOverride: (anahtar: string) => (anahtar === PLATFORM_ANAHTAR ? true : anahtar === PLATFORM_ROLLER_ANAHTAR ? roller : false) } as unknown as Reflector;
    const platformDb = db ? { db: { platformKullanici: { findUnique: async () => ({ oturumSurumu: 0, ...db }) }, platformOturum: { findUnique: async () => oturum } } } : undefined;
    const guard = new AuthGuard(new JwtService({ secret: KIRACI }), reflector, undefined, platformDb as never);
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never;
    return istekBaglami.run({}, async () => ({ sonuc: await guard.canActivate(context), platform: aktifPlatformBaglam() }));
  };

  it("işaretsiz platform ucu yalnız yöneticiye açıktır; editör 403 alır", async () => {
    await expect(kurRollu(platformToken, undefined, { rol: "yonetici", aktif: true })).resolves.toMatchObject({ sonuc: true, platform: { rol: "yonetici" } });
    await expect(kurRollu(platformToken, undefined, { rol: "mevzuat_editoru", aktif: true })).rejects.toThrow(ForbiddenException);
  });

  it("mevzuat ucu editöre açıktır; güncel rol token'daki rolün önüne geçer", async () => {
    const yoneticiTokeni = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform", rol: "yonetici", sv: 0, oid: "o1" }, { secret: PLATFORM });
    await expect(kurRollu(yoneticiTokeni, ["yonetici", "mevzuat_editoru"], { rol: "mevzuat_editoru", aktif: true })).resolves.toMatchObject({ platform: { rol: "mevzuat_editoru" } });
    await expect(kurRollu(yoneticiTokeni, undefined, { rol: "mevzuat_editoru", aktif: true })).rejects.toThrow(ForbiddenException);
  });

  it("pasif hesap rolünden önce düşer", async () => {
    await expect(kurRollu(platformToken, ["yonetici", "mevzuat_editoru"], { rol: "yonetici", aktif: false })).rejects.toThrow(UnauthorizedException);
  });

  it("PLT-25: sürüm ve oturum taşımayan eski token yeniden giriş ister", async () => {
    const eski = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform", rol: "yonetici" }, { secret: PLATFORM });
    await expect(kurRollu(eski, undefined, { rol: "yonetici", aktif: true })).rejects.toThrow(/yeniden giriş/);
  });

  it("PLT-25: sürümü eskimiş token (2FA sıfırlama / tüm oturumları kapatma sonrası) geçmez", async () => {
    await expect(kurRollu(platformToken, undefined, { rol: "yonetici", aktif: true, oturumSurumu: 1 })).rejects.toThrow(/Oturum kapatıldı/);
  });

  it("PLT-25: iptal edilmiş, süresi dolmuş ya da başka kullanıcının oturumu geçmez; oturum kimliği bağlama yazılır", async () => {
    const db = { rol: "yonetici", aktif: true };
    await expect(kurRollu(platformToken, undefined, db, { kullaniciId: "p1", iptalAt: new Date(), bitis: new Date(Date.now() + 60_000) })).rejects.toThrow(/Oturum kapatıldı/);
    await expect(kurRollu(platformToken, undefined, db, { kullaniciId: "p1", iptalAt: null, bitis: new Date(Date.now() - 1) })).rejects.toThrow(/Oturum kapatıldı/);
    await expect(kurRollu(platformToken, undefined, db, { kullaniciId: "p2", iptalAt: null, bitis: new Date(Date.now() + 60_000) })).rejects.toThrow(/Oturum kapatıldı/);
    await expect(kurRollu(platformToken, undefined, db)).resolves.toMatchObject({ platform: { kullaniciId: "p1", oturumId: "o1" } });
  });
});

describe("erişim çerezi ve CSRF (SEC-16)", () => {
  const jwt = new JwtService({});
  let kiraciToken: string, platformToken: string;
  beforeEach(async () => {
    process.env.JWT_SECRET = KIRACI;
    process.env.PLATFORM_JWT_SECRET = PLATFORM;
    kiraciToken = await jwt.signAsync({ sub: "u1", tenantId: "t1", rol: "yonetici" }, { secret: KIRACI });
    platformToken = await jwt.signAsync({ sub: "p1", eposta: "p@x.io", kapsam: "platform", rol: "yonetici" }, { secret: PLATFORM });
  });
  afterEach(() => { delete process.env.PLATFORM_JWT_SECRET; });

  const cerezle = (platformUcu: boolean, istek: { method: string; cookies?: Record<string, string>; headers?: Record<string, string> }) => {
    const reflector = { getAllAndOverride: (anahtar: string) => (anahtar === PLATFORM_ANAHTAR ? platformUcu : anahtar === PLATFORM_ROLLER_ANAHTAR ? ["yonetici"] : false) } as unknown as Reflector;
    const guard = new AuthGuard(new JwtService({ secret: KIRACI }), reflector);
    (guard as unknown as { platformKullaniciDurumu: () => Promise<{ rol: string }> }).platformKullaniciDurumu = async () => ({ rol: "yonetici" });
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...istek }) }) } as never;
    return istekBaglami.run({}, () => guard.canActivate(context));
  };

  it("çerezle okuma isteği başlıksız geçer", async () => {
    await expect(cerezle(false, { method: "GET", cookies: { tekir_access: kiraciToken } })).resolves.toBe(true);
  });

  it("çerezle yazma isteği özel başlık olmadan 403 alır, başlıkla geçer", async () => {
    await expect(cerezle(false, { method: "POST", cookies: { tekir_access: kiraciToken } })).rejects.toThrow(ForbiddenException);
    await expect(cerezle(false, { method: "POST", cookies: { tekir_access: kiraciToken }, headers: { "x-tekir-istek": "1" } })).resolves.toBe(true);
  });

  it("başka siteden gelen yazma isteği başlık olsa da reddedilir", async () => {
    await expect(cerezle(false, { method: "POST", cookies: { tekir_access: kiraciToken }, headers: { "x-tekir-istek": "1", "sec-fetch-site": "cross-site" } })).rejects.toThrow(ForbiddenException);
  });

  it("Bearer yazma isteği CSRF denetimine girmez ve çereze göre önceliklidir", async () => {
    await expect(cerezle(false, { method: "POST", headers: { authorization: `Bearer ${kiraciToken}` } })).resolves.toBe(true);
    await expect(cerezle(false, { method: "GET", cookies: { tekir_access: kiraciToken }, headers: { authorization: "Bearer bozuk" } })).rejects.toThrow(UnauthorizedException);
  });

  it("firma ve platform çerezleri birbirinin yerine geçmez", async () => {
    await expect(cerezle(true, { method: "GET", cookies: { tekir_platform_access: platformToken } })).resolves.toBe(true);
    await expect(cerezle(true, { method: "GET", cookies: { tekir_access: kiraciToken } })).rejects.toThrow(UnauthorizedException);
    await expect(cerezle(false, { method: "GET", cookies: { tekir_platform_access: platformToken } })).rejects.toThrow(UnauthorizedException);
  });
});

describe("giriş yanıtında token (SEC-16)", () => {
  const sonuc = { accessToken: "gizli", kullanici: { id: "u1" } };
  it("tarayıcıya gövdede token verilmez", () => {
    expect(girisYaniti({ headers: { "sec-fetch-site": "same-origin" } }, sonuc)).toEqual({ kullanici: { id: "u1" } });
  });
  it("tarayıcı dışı istemci token'ı gövdede alır", () => {
    expect(girisYaniti({ headers: {} }, sonuc)).toEqual(sonuc);
  });
});
