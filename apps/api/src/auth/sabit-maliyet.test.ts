import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";
import { AuthService } from "./auth.service";
import { PlatformAuthService } from "../mevzuat/platform-auth.service";

const dogrula = vi.hoisted(() => vi.fn(async () => false));
vi.mock("argon2", async (asil) => ({ ...(await asil<typeof import("argon2")>()), verify: dogrula }));

const firmaServisi = (kimlik: unknown, kullanici: unknown) => {
  const tx = { user: { findUnique: async () => kullanici } };
  const prisma = {
    authKimlik: { findFirst: async () => kimlik },
    tenantIslem: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return new AuthService(prisma as never, {} as never, GirisDenemeSayaci.bellekte(), {} as never);
};

const platformServisi = (kullanici: unknown) => {
  const db = {
    platformKullanici: { findUnique: async () => kullanici },
    mevzuatOlay: { create: async () => ({}) },
  };
  return new PlatformAuthService({ db } as never, {} as never, GirisDenemeSayaci.bellekte(), {} as never);
};

describe("giriş hesap yokken de parola maliyeti harcar (SEC-12)", () => {
  beforeEach(() => {
    dogrula.mockClear();
    process.env.PLATFORM_JWT_SECRET = "platform-test-anahtari-0123456789";
    process.env.JWT_SECRET = "kiraci-test-anahtari-0123456789ab";
  });

  it.each([
    ["kayıtlı olmayan e-posta", null, null],
    ["rehberde olup kullanıcısı bulunmayan", { tenantId: "t1", userId: "u1" }, null],
    ["pasif kullanıcı", { tenantId: "t1", userId: "u1" }, { aktif: false }],
  ])("firma girişi: %s", async (_ad, kimlik, kullanici) => {
    await expect(firmaServisi(kimlik, kullanici).giris("kisi@ornek.com", "denenen-parola")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(dogrula).toHaveBeenCalledTimes(1);
    expect(dogrula.mock.calls[0]).toEqual([expect.stringMatching(/^\$argon2/), "denenen-parola"]);
  });

  it.each([
    ["kayıtlı olmayan e-posta", null],
    ["pasif hesap", { id: "p1", aktif: false }],
    ["kurulum bekleyen hesap", { id: "p1", aktif: true, davetTuru: "davet" }],
  ])("platform girişi: %s", async (_ad, kullanici) => {
    await expect(platformServisi(kullanici).giris("ekip@ornek.com", "denenen-parola", "000000")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(dogrula).toHaveBeenCalledTimes(1);
    expect(dogrula.mock.calls[0]).toEqual([expect.stringMatching(/^\$argon2/), "denenen-parola"]);
  });
});
