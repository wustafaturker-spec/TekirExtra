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

describe("özel rol kutuları (KLN-20)", () => {
  const ozelle = (rol: string, gerekli: string[] | undefined, method: string, path: string, kapali: string[], saltOkuma = false) => {
    const reflector = { getAllAndOverride: (anahtar: string) => (anahtar === "roller" ? gerekli : saltOkuma) } as never;
    const guard = new RollerGuard(reflector);
    const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ method, path }) }) } as never;
    return istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: rol as never, ozelRol: { id: "o1", kapali } } }, () => guard.canActivate(ctx));
  };

  it("şablonun açtığı uç özel rolde kapalı kutuya düşerse reddedilir; diğerleri açık kalır", () => {
    const kapali = ["kasa_banka.goruntule", "fatura.onayla"];
    expect(() => ozelle("muhasebe", ["muhasebe"], "GET", "/api/v1/kasa-banka/hesaplar", kapali)).toThrow(/Rolünüzde bu işlem kapalı/);
    expect(() => ozelle("muhasebe", ["muhasebe"], "POST", "/api/v1/fatura/1/kesinlestir", kapali)).toThrow(/kapalı/);
    expect(ozelle("muhasebe", ["muhasebe"], "POST", "/api/v1/fatura", kapali)).toBe(true);
    expect(ozelle("muhasebe", undefined, "GET", "/api/v1/auth/ben", kapali)).toBe(true);
  });

  it("özel rol şablonu aşamaz: şablonun girmediği uç kapalı kalır", () => {
    expect(() => ozelle("satis", ["muhasebe"], "GET", "/api/v1/kasa-banka/hesaplar", [])).toThrow(/yetkiniz yok/);
  });

  it("salt okunur POST (rapor çalıştırma) görüntüleme sayılır", () => {
    expect(() => ozelle("muhasebe", undefined, "POST", "/api/v1/raporlar/x/calistir", ["raporlar.goruntule"], true)).toThrow(/kapalı/);
    expect(ozelle("muhasebe", undefined, "POST", "/api/v1/raporlar/x/calistir", ["raporlar.duzenle"], true)).toBe(true);
  });
});
