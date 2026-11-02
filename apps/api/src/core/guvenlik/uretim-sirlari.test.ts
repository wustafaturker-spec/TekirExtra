import { describe, expect, it } from "vitest";
import { uretimSirlariniDenetle, uretimSirSorunlari } from "./uretim-sirlari";

const GUCLU = {
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(10) + "b9f3c1e7d2a84f60b5c3e1d7f9a2b4c6",
  PLATFORM_JWT_SECRET: "c7e1f3a9b5d2468ace0f1b3d5e7a9c2e4f6b8d0a",
  OTURUM_ISARETI_SECRET: "5b8e2f1a9c3d7e6b4a0f2c8e1d9b3a7f5c6e4d2b",
  BAGLANTI_SIFRELEME_ANAHTARI: "3f9a1c7e5b2d8f4a6c0e9b1d3f5a7c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a",
  S3_GIZLI_ANAHTAR: "9d1e7c3a5b8f2e4d6a0c1b9f7e3d5a2c",
};

describe("uretimSirSorunlari", () => {
  it("geliştirme ortamında denetlemez", () => {
    expect(uretimSirSorunlari({ NODE_ENV: "development", JWT_SECRET: "dev-jwt-secret-degistir" })).toEqual([]);
    expect(uretimSirSorunlari({})).toEqual([]);
  });

  it("güçlü sırlarla üretimde sorun yok", () => {
    expect(uretimSirSorunlari(GUCLU)).toEqual([]);
    expect(() => uretimSirlariniDenetle(GUCLU)).not.toThrow();
  });

  it("depodaki örnek değerleri reddeder", () => {
    const sorunlar = uretimSirSorunlari({
      NODE_ENV: "production",
      JWT_SECRET: "dev-jwt-secret-degistir",
      PLATFORM_JWT_SECRET: "dev-platform-jwt-secret-degistir",
      OTURUM_ISARETI_SECRET: "dev-oturum-isareti-degistir-0123456789abcdef",
      BAGLANTI_SIFRELEME_ANAHTARI: "0".repeat(64),
      S3_GIZLI_ANAHTAR: "9d1e7c3a5b8f2e4d6a0c1b9f7e3d5a2c",
    });
    expect(sorunlar).toHaveLength(4);
    expect(() => uretimSirlariniDenetle({ NODE_ENV: "production", JWT_SECRET: "dev-jwt-secret-degistir" })).toThrow(/JWT_SECRET/);
  });

  it("örnek veritabanı parolasını ve dosya deposu anahtarını reddeder", () => {
    expect(uretimSirSorunlari({ ...GUCLU, DATABASE_URL_MIGRATE: "postgresql://tekir:tekir@localhost:5433/x" })[0]).toMatch(/DATABASE_URL_MIGRATE.*örnek/);
    expect(uretimSirSorunlari({ ...GUCLU, DATABASE_URL: "postgresql://tekir_app:9f8e7d6c@localhost:5433/x" })).toEqual([]);
    expect(uretimSirSorunlari({ ...GUCLU, S3_GIZLI_ANAHTAR: "tekir-minio-dev" })).toEqual(["S3_GIZLI_ANAHTAR depodaki örnek değer"]);
    expect(uretimSirSorunlari({ ...GUCLU, S3_GIZLI_ANAHTAR: "" })).toEqual(["S3_GIZLI_ANAHTAR tanımlı değil"]);
  });

  it("eksik ya da kısa JWT_SECRET reddedilir", () => {
    expect(uretimSirSorunlari({ ...GUCLU, JWT_SECRET: "" })).toEqual(["JWT_SECRET tanımlı değil"]);
    expect(uretimSirSorunlari({ ...GUCLU, JWT_SECRET: "kisa-sir" })[0]).toMatch(/en az 32/);
  });

  it("yerel docker istisnası açıkken denetlemez", () => {
    expect(uretimSirSorunlari({ NODE_ENV: "production", GUVENSIZ_ORNEK_SIRLARA_IZIN_VER: "true", JWT_SECRET: "dev-jwt-secret-degistir" })).toEqual([]);
  });
});
