import { describe, expect, it } from "vitest";
import { kabulOrtami, sunucuYonetimAdresi } from "../../test/kabul-ortami";

const pilot = {
  DATABASE_URL: "postgresql://tekir_app:g%40zli@localhost:5433/tekirextra",
  DATABASE_URL_MIGRATE: "postgresql://tekir:p@localhost:5433/tekirextra",
  DATABASE_URL_PLATFORM: "postgresql://tekir_platform:p@localhost:5433/tekirextra?connection_limit=4",
  REDIS_URL: "redis://:sifre@localhost:6380",
};

describe("kabul ortamı (pilot veritabanından ayrım)", () => {
  it("üç veritabanı adresini aynı sunucu ve rollerle kabul veritabanına çevirir", () => {
    const o = kabulOrtami(pilot);
    expect(o.DATABASE_URL).toBe("postgresql://tekir_app:g%40zli@localhost:5433/tekirextra_kabul");
    expect(o.DATABASE_URL_MIGRATE).toBe("postgresql://tekir:p@localhost:5433/tekirextra_kabul");
    expect(o.DATABASE_URL_PLATFORM).toBe("postgresql://tekir_platform:p@localhost:5433/tekirextra_kabul?connection_limit=4");
    expect(o.KABUL_VERITABANI).toBe("tekirextra_kabul");
  });

  it("Redis'i ayrı mantıksal veritabanına, kovayı ayrı ada taşır", () => {
    const o = kabulOrtami(pilot);
    expect(new URL(o.REDIS_URL).pathname).toBe("/1");
    expect(new URL(o.REDIS_URL).password).toBe("sifre");
    expect(o.S3_KOVA).toBe("tekirextra-ekler-kabul");
    expect(new URL(kabulOrtami({ ...pilot, REDIS_URL: "redis://localhost:6380/1" }).REDIS_URL).pathname).toBe("/2");
  });

  it("pilotla aynı ya da 'kabul' içermeyen hedefi reddeder", () => {
    expect(() => kabulOrtami({ ...pilot, KABUL_VERITABANI: "tekirextra" })).toThrow(/güvenli değil/);
    expect(() => kabulOrtami({ ...pilot, KABUL_VERITABANI: "baska_db" })).toThrow(/güvenli değil/);
    expect(() => kabulOrtami({ ...pilot, KABUL_REDIS_DB: "0" })).toThrow(/Redis/);
    expect(() => kabulOrtami({ ...pilot, S3_KOVA: "k", KABUL_S3_KOVA: "k" })).toThrow(/kova/);
  });

  it("farklı veritabanlarını gösteren adresleri reddeder", () => {
    expect(() => kabulOrtami({ ...pilot, DATABASE_URL_PLATFORM: "postgresql://x:y@localhost:5433/baska" })).toThrow(/başka bir veritabanını/);
  });

  it("yönetim adresi postgres veritabanına gider", () => {
    expect(sunucuYonetimAdresi(pilot.DATABASE_URL_MIGRATE)).toBe("postgresql://tekir:p@localhost:5433/postgres");
  });
});
