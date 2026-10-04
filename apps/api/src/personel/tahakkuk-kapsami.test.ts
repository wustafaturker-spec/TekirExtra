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

import { izinliPrimGunu } from "./tahakkuk-kapsami";
describe("ücretsiz izin ve prim günü (PRS-09)", () => {
  const tamAy = [d("2025-01-01")];
  it("ücretsiz izin takvim günü kadar prim gününden düşer, neden önerilir", () => {
    expect(izinliPrimGunu(tamAy, [{ baslangicTarihi: t("2026-10-20"), bitisTarihi: t("2026-10-31"), turKod: "ucretsiz" }], 2026, 10)).toEqual({ istihdamGunu: 30, ucretsizIzinGunu: 12, primGunu: 18, eksikGunNedeni: "ucretsiz_izin" });
    expect(izinliPrimGunu(tamAy, [{ baslangicTarihi: t("2026-09-28"), bitisTarihi: t("2026-10-02"), turKod: "hastalik" }], 2026, 10)).toMatchObject({ ucretsizIzinGunu: 2, primGunu: 28, eksikGunNedeni: "istirahat" });
  });
  it("istihdam dışındaki izin günü sayılmaz; çakışan izinler bir kez sayılır; ay tamamı 0", () => {
    expect(izinliPrimGunu([d("2025-01-01", "2026-10-10")], [{ baslangicTarihi: t("2026-10-05"), bitisTarihi: t("2026-10-20"), turKod: "ucretsiz" }], 2026, 10)).toMatchObject({ istihdamGunu: 10, ucretsizIzinGunu: 6, primGunu: 4 });
    expect(izinliPrimGunu(tamAy, [{ baslangicTarihi: t("2026-10-01"), bitisTarihi: t("2026-10-10"), turKod: "ucretsiz" }, { baslangicTarihi: t("2026-10-05"), bitisTarihi: t("2026-10-12"), turKod: "ucretsiz" }], 2026, 10).ucretsizIzinGunu).toBe(12);
    expect(izinliPrimGunu(tamAy, [{ baslangicTarihi: t("2026-10-01"), bitisTarihi: t("2026-10-31"), turKod: "ucretsiz" }], 2026, 10).primGunu).toBe(0);
    expect(izinliPrimGunu(tamAy, [], 2026, 10)).toEqual({ istihdamGunu: 30, ucretsizIzinGunu: 0, primGunu: 30, eksikGunNedeni: null });
  });
});
