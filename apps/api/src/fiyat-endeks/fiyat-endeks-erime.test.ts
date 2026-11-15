import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { sonFiyatDegisikligi } from "./fiyat-endeks-erime.raporlar";

const f = (ay: string, v: string) => ({ ay, fiyat: new Prisma.Decimal(v) });
describe("END-15 son fiyat değişikliği", () => {
  it("%0,5'ten küçük oynama değişiklik sayılmaz; son gerçek değişiklik ayı döner", () => {
    expect(sonFiyatDegisikligi([f("2026-01-01", "100"), f("2026-02-01", "100.3"), f("2026-04-01", "110"), f("2026-06-01", "110.2")])).toBe("2026-04-01");
  });
  it("hiç değişmediyse ilk satış ayı; boşsa null", () => {
    expect(sonFiyatDegisikligi([f("2025-11-01", "50"), f("2026-03-01", "50")])).toBe("2025-11-01");
    expect(sonFiyatDegisikligi([])).toBeNull();
  });
});
