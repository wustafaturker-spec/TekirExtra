import { describe, expect, it } from "vitest";
import { adSoyadCoz, gercekKisiUnvani } from "./ad-soyad";

describe("adSoyadCoz (CARI-21)", () => {
  it("kartta girilmiş ad ve soyadı olduğu gibi kullanır", () => {
    expect(adSoyadCoz({ unvan: "Ayşe Nur Yılmaz Demir", ad: "Ayşe Nur", soyad: "Yılmaz Demir" })).toEqual({
      ad: "Ayşe Nur",
      soyad: "Yılmaz Demir",
      tahmin: false,
    });
  });

  it("ad veya soyad eksikse unvandan tahmin eder ve bunu bildirir", () => {
    expect(adSoyadCoz({ unvan: "Ayşe Nur Yılmaz" })).toEqual({ ad: "Ayşe Nur", soyad: "Yılmaz", tahmin: true });
    expect(adSoyadCoz({ unvan: "Ayşe Yılmaz", ad: "Ayşe", soyad: null })).toEqual({ ad: "Ayşe", soyad: "Yılmaz", tahmin: true });
  });

  it("tek kelimelik unvanda aynı kelimeyi ad ve soyad sayar", () => {
    expect(adSoyadCoz({ unvan: "Mehmet" })).toEqual({ ad: "Mehmet", soyad: "Mehmet", tahmin: true });
  });

  it("unvanı ad ve soyaddan kurar", () => {
    expect(gercekKisiUnvani(" Ayşe Nur ", "Yılmaz ")).toBe("Ayşe Nur Yılmaz");
  });
});
