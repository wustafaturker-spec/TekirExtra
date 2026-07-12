import { describe, expect, it } from "vitest";
import { kdvTutari, kurusToTL, satirTutari } from "./para";

describe("satirTutari", () => {
  it("miktar × birim fiyat hesaplar", () => {
    expect(satirTutari(3, 10_00)).toBe(30_00);
  });

  it("iskonto oranını düşer", () => {
    expect(satirTutari(2, 100_00, 10)).toBe(180_00);
  });

  it("kesirli miktarda kuruşa yuvarlar", () => {
    // 1.5 kg × 33,33 TL = 49,995 → 50,00
    expect(satirTutari(1.5, 33_33)).toBe(50_00);
  });

  it("geçersiz iskonto oranını reddeder", () => {
    expect(() => satirTutari(1, 100, 101)).toThrow(RangeError);
  });

  it("kayan nokta birim fiyatı reddeder", () => {
    expect(() => satirTutari(1, 10.5)).toThrow(RangeError);
  });
});

describe("kdvTutari", () => {
  it("yüzde 20 KDV hesaplar", () => {
    expect(kdvTutari(100_00, 20)).toBe(20_00);
  });

  it("yarıdan yukarı yuvarlar", () => {
    // 1,25 TL × %10 = 12,5 kuruş → 13 kuruş
    expect(kdvTutari(125, 10)).toBe(13);
  });
});

describe("kurusToTL", () => {
  it("Türkçe para biçimi üretir", () => {
    expect(kurusToTL(123_456)).toBe("1.234,56");
  });
});
