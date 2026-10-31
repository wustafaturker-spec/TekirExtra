import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { generateSecret, generateSync } from "otplib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/auth/auth.guard";
import { GirisDenemeSayaci } from "../src/auth/giris-deneme-sayaci";
import { PLATFORM_ANAHTAR, PLATFORM_ROLLER_ANAHTAR } from "../src/auth/public.decorator";
import { istekBaglami, platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { sifrele } from "../src/core/kripto";
import { PlatformAuthService } from "../src/mevzuat/platform-auth.service";
import { PlatformKullanicilarService } from "../src/mevzuat/platform-kullanicilar.service";
import { PLATFORM_DURUM_ONBELLEK_MS, PlatformOturumDurumService } from "../src/mevzuat/platform-oturum-durum.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-25: platform oturum iptali gerçek PostgreSQL'de, gerçek giriş ve gerçek
 * guard ile. İki guard örneği iki ayrı API sürecidir (ayrı önbellek): iptal
 * işlemi yapan süreçte hemen, diğerinde en geç 10 sn içinde etkili olur.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
process.env.PLATFORM_JWT_SECRET ??= "plt25-kabul-platform-anahtari-0123456789";
// Davet e-postası gönderilmesin; kurulum bağlantısı yanıtta dönsün.
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const baglanti = { db: platform } as unknown as PlatformPrismaService;
const jwt = new JwtService({});

/** Bir API süreci: kendi önbelleği, kendi guard'ı ve servisleri. */
function surec() {
  const durum = new PlatformOturumDurumService(baglanti);
  const reflector = { getAllAndOverride: (a: string) => (a === PLATFORM_ANAHTAR ? true : a === PLATFORM_ROLLER_ANAHTAR ? ["yonetici", "mevzuat_editoru"] : false) } as unknown as Reflector;
  const guard = new AuthGuard(new JwtService({ secret: "kiraci-anahtari-plt25" }), reflector, undefined, baglanti, undefined, undefined, durum);
  const istek = (token: string) => istekBaglami.run({}, () => guard.canActivate({ getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never));
  return { istek, auth: new PlatformAuthService(baglanti, jwt, GirisDenemeSayaci.bellekte(), durum), kullanicilar: new PlatformKullanicilarService(baglanti, durum) };
}

const iz = `plt25-${randomUUID().slice(0, 8)}`;
const PAROLA = "KabulParola2026!";
let secret: string, kisiId: string, yoneticiId: string;
const giris = async (s: ReturnType<typeof surec>) => (await s.auth.giris(`${iz}@ornek.invalid`, PAROLA, generateSync({ secret }))).accessToken;

beforeAll(async () => {
  secret = generateSecret();
  const parolaHash = await argon2.hash(PAROLA);
  kisiId = (await yonetici.platformKullanici.create({ data: { eposta: `${iz}@ornek.invalid`, adSoyad: `${iz} kişi`, parolaHash, totpSecretSifreli: sifrele(secret), rol: "yonetici" } })).id;
  yoneticiId = (await yonetici.platformKullanici.create({ data: { eposta: `${iz}-yonetici@ornek.invalid`, adSoyad: `${iz} yönetici`, parolaHash, totpSecretSifreli: sifrele(secret), rol: "yonetici" } })).id;
});

afterAll(async () => {
  vi.useRealTimers();
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ANY(${[kisiId, yoneticiId]}::uuid[])`;
  await yonetici.platformKullanici.deleteMany({ where: { id: { in: [kisiId, yoneticiId] } } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-25 — kalıcı platform oturum iptali (gerçek PostgreSQL)", () => {
  it("giriş oturum kaydı açar; token sürüm ve oturum taşır, guard kabul eder", async () => {
    const a = surec();
    const token = await giris(a);
    const yuk = jwt.decode(token) as { sv: number; oid: string; exp: number; iat: number };
    expect(yuk).toMatchObject({ sv: 0, oid: expect.any(String) });
    expect(yuk.exp - yuk.iat).toBe(30 * 60);
    expect(await platform.platformOturum.findUnique({ where: { id: yuk.oid } })).toMatchObject({ kullaniciId: kisiId, iptalAt: null });
    await expect(a.istek(token)).resolves.toBe(true);
  });

  it("çıkış yapılan token aynı süreçte hemen, diğer süreçte en geç 10 sn içinde reddedilir; diğer oturum etkilenmez", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const [a, b] = [surec(), surec()];
    const [t1, t2] = [await giris(a), await giris(a)];
    await expect(b.istek(t1)).resolves.toBe(true); // b önbelleğe aldı
    expect(await a.auth.cikis(t1)).toBe(true);
    await expect(a.istek(t1)).rejects.toThrow(/Oturum kapatıldı/);
    await expect(a.istek(t2)).resolves.toBe(true);
    vi.setSystemTime(Date.now() + PLATFORM_DURUM_ONBELLEK_MS + 1);
    await expect(b.istek(t1)).rejects.toThrow(UnauthorizedException);
    await expect(b.istek(t2)).resolves.toBe(true);
    expect((await platform.platformOturum.findUnique({ where: { id: (jwt.decode(t1) as { oid: string }).oid } }))?.iptalNedeni).toBe("cikis");
    vi.useRealTimers();
  });

  it("tüm oturumları kapatma bütün token'ları düşürür; yeni giriş yeni sürümle çalışır", async () => {
    const a = surec();
    const [t1, t2] = [await giris(a), await giris(a)];
    await platformBaglamiylaCalistir({ kullaniciId: kisiId, eposta: "x", rol: "yonetici", oturumId: (jwt.decode(t1) as { oid: string }).oid }, () => a.auth.tumOturumlariKapat());
    await expect(a.istek(t1)).rejects.toThrow(/Oturum kapatıldı/);
    await expect(a.istek(t2)).rejects.toThrow(/Oturum kapatıldı/);
    const t3 = await giris(a);
    expect((jwt.decode(t3) as { sv: number }).sv).toBe(1);
    await expect(a.istek(t3)).resolves.toBe(true);
  });

  it("2FA sıfırlama + yeniden kurulum sonrasında eski token geçerli olmaz", async () => {
    const a = surec();
    const eski = await giris(a);
    const davet = await platformBaglamiylaCalistir({ kullaniciId: yoneticiId, eposta: "y", rol: "yonetici" }, () => a.kullanicilar.ikiAdimSifirla(kisiId));
    await expect(a.istek(eski)).rejects.toThrow(UnauthorizedException);
    const onceki = surec();
    await expect(onceki.istek(eski)).rejects.toThrow(/pasif/); // kurulum beklerken "pasif" önbelleğe alır
    // Yeniden kurulum: davet bilgisi yeni sırrı verir, mevcut parola + ilk kod ile tamamlanır.
    const anahtar = new URLSearchParams(new URL(davet.baglanti!).hash.slice(1)).get("anahtar")!;
    const bilgi = await a.kullanicilar.davetBilgisi(anahtar);
    await a.kullanicilar.davetTamamla(anahtar, { parola: PAROLA, kod: generateSync({ secret: bilgi.secret }) });
    secret = bilgi.secret;
    expect((await platform.platformKullanici.findUniqueOrThrow({ where: { id: kisiId } })).davetTuru).toBeNull();
    await expect(a.istek(eski)).rejects.toThrow(/Oturum kapatıldı/);
    await expect(surec().istek(eski)).rejects.toThrow(/Oturum kapatıldı/);
    // Yeni giriş, sıfırlama sırasında "pasif" önbelleğe almış başka süreçte de beklemeden geçer.
    const b = surec();
    await expect(b.istek(eski)).rejects.toThrow(UnauthorizedException);
    const yeni = await giris(a);
    await expect(a.istek(yeni)).resolves.toBe(true);
    await expect(b.istek(yeni)).resolves.toBe(true);
    await expect(onceki.istek(yeni)).resolves.toBe(true);
  });

  it("platform rolü dışında oturum tablosuna erişilemez", async () => {
    const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await expect(uygulama.$queryRaw`SELECT count(*) FROM platform_oturumlari`).rejects.toThrow(/permission denied/);
    await uygulama.$disconnect();
  });
});
