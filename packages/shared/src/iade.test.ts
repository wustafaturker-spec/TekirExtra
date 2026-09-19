import { describe, expect, it } from "vitest";
import { gibBelgeNoMu, iadeEngelleri } from "./iade";

describe("iade referansı (EBLG-58)", () => {
  it("GİB biçimli 16 haneli numarayı tanır", () => {
    expect(gibBelgeNoMu("ABC2026000000001")).toBe(true);
    expect(gibBelgeNoMu("K072026000000052")).toBe(true);
    expect(gibBelgeNoMu("ABC1")).toBe(false);
    expect(gibBelgeNoMu("ABC20260000000011")).toBe(false);
    expect(gibBelgeNoMu(null)).toBe(false);
  });

  it("referanssız iadeyi durdurur", () => {
    expect(iadeEngelleri([], "2026-09-19")).toHaveLength(1);
  });

  it("geçerli referansları kabul eder", () => {
    expect(iadeEngelleri([
      { belgeNo: "ABC2026000000001", tarih: "2026-09-10" },
      { belgeNo: "abc2026000000002", tarih: new Date("2026-09-19T00:00:00Z") },
    ], "2026-09-19")).toEqual([]);
  });

  it("kısa numarayı, eksik ve ileri tarihi, mükerrer numarayı yakalar", () => {
    const engeller = iadeEngelleri([
      { belgeNo: "ABC1", tarih: "2026-09-10" },
      { belgeNo: "ABC2026000000001", tarih: null },
      { belgeNo: "ABC2026000000002", tarih: "2026-09-20" },
      { belgeNo: "abc2026000000002", tarih: "2026-09-01" },
    ], "2026-09-19");
    expect(engeller.map((e) => e.sira)).toEqual([1, 2, 3, 4]);
    expect(engeller[2].mesaj).toContain("iade faturasının tarihinden sonra");
    expect(engeller[3].mesaj).toContain("birden çok kez");
  });
});
