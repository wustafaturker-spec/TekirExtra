import { describe, expect, it } from "vitest";
import { devirHesabi } from "./stok.raporlar";

describe("stok devir hızı (RPR-18)", () => {
  it("satış ÷ ortalama stok; stokta kalma = gün ÷ devir", () => {
    expect(devirHesabi(120, 100, 20, 30)).toEqual({ ortalama: 60, devir: 2, stoktaGun: 15 });
  });

  it("hiç satılmayan stok devir 0'dır, kalma süresi yok", () => {
    expect(devirHesabi(0, 50, 50, 30)).toEqual({ ortalama: 50, devir: 0, stoktaGun: null });
  });

  it("eksi stok ortalamaya eksi girmez; stoksuz satışta devir hesaplanmaz", () => {
    expect(devirHesabi(10, -5, 15, 30).ortalama).toBe(7.5);
    expect(devirHesabi(10, 0, -3, 30).devir).toBeNull();
  });
});
