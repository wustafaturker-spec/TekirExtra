import { describe, expect, it } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { RollerGuard } from "./roller.guard";

const baglamla = (rol: string, gerekli: string[] | undefined, path: string) => {
  const guard = new RollerGuard({ getAllAndOverride: () => gerekli } as never);
  const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ path }) }) } as never;
  return istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: rol as never } }, () => guard.canActivate(ctx));
};

describe("çalışan rol kapısı (PRS-21)", () => {
  it("çalışan @Roller taşımayan genel uçlara erişemez; hesap uçları açık", () => {
    expect(() => baglamla("calisan", undefined, "/api/v1/firma")).toThrow(/yetkiniz yok/);
    expect(() => baglamla("calisan", undefined, "/api/v1/cari")).toThrow(/yetkiniz yok/);
    expect(baglamla("calisan", undefined, "/api/v1/auth/ben")).toBe(true);
    expect(baglamla("calisan", undefined, "/api/v1/bildirimler/ozet")).toBe(true);
    expect(() => baglamla("calisan", ["muhasebe"], "/api/v1/personel")).toThrow(/yetkiniz yok/);
    expect(baglamla("calisan", ["calisan"], "/api/v1/self-servis/ben")).toBe(true);
  });
  it("öbür rollerin davranışı değişmez", () => {
    expect(baglamla("muhasebe", undefined, "/api/v1/firma")).toBe(true);
    expect(baglamla("yonetici", ["calisan"], "/api/v1/self-servis/ben")).toBe(true);
    expect(() => baglamla("satis", ["calisan"], "/api/v1/self-servis/ben")).toThrow();
  });
});
