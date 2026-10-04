import { describe, expect, it } from "vitest";
import { istihdamGunu } from "./tahakkuk-kapsami";

const t = (iso: string) => new Date(`${iso}T00:00:00Z`);
const d = (bas: string, bit: string | null = null) => ({ baslangicTarihi: t(bas), bitisTarihi: bit ? t(bit) : null });

describe("istihdam günü (PRS-02)", () => {
  it("tam ay her ayda 30", () => {
    expect(istihdamGunu([d("2025-01-01")], 2026, 2)).toBe(30);
    expect(istihdamGunu([d("2025-01-01")], 2026, 3)).toBe(30);
    expect(istihdamGunu([d("2026-03-01", "2026-03-31")], 2026, 3)).toBe(30);
  });
  it("ay içi giriş: girişten ay sonuna takvim günü", () => {
    expect(istihdamGunu([d("2026-09-20")], 2026, 9)).toBe(11);
    expect(istihdamGunu([d("2026-02-15")], 2026, 2)).toBe(14);
    expect(istihdamGunu([d("2026-03-02")], 2026, 3)).toBe(30);
  });
  it("ay içi çıkış: çıkış günü dahil", () => {
    expect(istihdamGunu([d("2025-01-01", "2026-10-15")], 2026, 10)).toBe(15);
    expect(istihdamGunu([d("2026-10-10", "2026-10-12")], 2026, 10)).toBe(3);
  });
  it("aynı ayda yeniden işe giriş günleri toplanır; kesişmeyen ay 0", () => {
    expect(istihdamGunu([d("2025-01-01", "2026-05-10"), d("2026-05-21")], 2026, 5)).toBe(21);
    expect(istihdamGunu([d("2025-01-01", "2026-04-30")], 2026, 5)).toBe(0);
  });
});
