import { describe, expect, it } from "vitest";
import { hizmetYildonumleri, islenecekHakEdisler, yasHesapla, yillikIzinGunu } from "./izin-hak-edisi";

const t = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("yıllık izin hakkı (PRS-08, İş K. m.53)", () => {
  it("kıdem kademeleri ve yaş alt sınırı", () => {
    expect([1, 5, 6, 14, 15, 30].map((k) => yillikIzinGunu(k, 30))).toEqual([14, 14, 20, 20, 26, 26]);
    expect(yillikIzinGunu(2, 18)).toBe(20);
    expect(yillikIzinGunu(2, 50)).toBe(20);
    expect(yillikIzinGunu(20, 55)).toBe(26);
    expect(yillikIzinGunu(2, null)).toBe(14);
  });
  it("yaş doğum gününe göre", () => {
    expect(yasHesapla(t("1976-10-05"), t("2026-10-04"))).toBe(49);
    expect(yasHesapla(t("1976-10-04"), t("2026-10-04"))).toBe(50);
  });
  it("tek dönemde takvim yıl dönümleri; çıkıştan sonrası sayılmaz", () => {
    expect(hizmetYildonumleri([{ baslangicTarihi: t("2023-03-15"), bitisTarihi: null }], t("2026-10-04")).map((d) => d.toISOString().slice(0, 10))).toEqual(["2024-03-15", "2025-03-15", "2026-03-15"]);
    expect(hizmetYildonumleri([{ baslangicTarihi: t("2023-03-15"), bitisTarihi: t("2025-01-01") }], t("2026-10-04"))).toHaveLength(1);
  });
  it("kesintili çalışmalar birleştirilir", () => {
    // 200 gün + ara + 200 gün → 365. gün ikinci dönemin 165. günü
    const d = hizmetYildonumleri([{ baslangicTarihi: t("2024-01-01"), bitisTarihi: t("2024-07-18") }, { baslangicTarihi: t("2025-01-01"), bitisTarihi: null }], t("2026-10-04"));
    expect(d[0].toISOString().slice(0, 10)).toBe("2025-06-14");
  });
  it("ilk işlemde yalnız son dolan yıl; sonra eksikler sırayla", () => {
    expect(islenecekHakEdisler([t("2024-01-01"), t("2025-01-01"), t("2026-01-01")], [])).toEqual([3]);
    expect(islenecekHakEdisler([t("2024-01-01"), t("2025-01-01"), t("2026-01-01")], [2])).toEqual([3]);
    expect(islenecekHakEdisler([t("2024-01-01"), t("2025-01-01")], [2])).toEqual([]);
    expect(islenecekHakEdisler([], [])).toEqual([]);
  });
});

import { isGunuSayisi } from "./izin.service";
describe("izin günü cumartesi kuralı (PRS-08)", () => {
  // 2026-10-05 pzt … 2026-10-11 paz
  it("varsayılan cumartesi sayılmaz, 6 günlük işyerinde sayılır; pazar hiç sayılmaz", () => {
    expect(isGunuSayisi(t("2026-10-05"), t("2026-10-11"))).toBe(5);
    expect(isGunuSayisi(t("2026-10-05"), t("2026-10-11"), [], true)).toBe(6);
  });
});
