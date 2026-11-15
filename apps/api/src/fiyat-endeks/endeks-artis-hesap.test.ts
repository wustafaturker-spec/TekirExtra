import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { artisHesapla, artisSonAyi, yeniBedel } from "./endeks-artis-hesap";
import { oneriYili } from "./endeks-artis.service";
import { ayKaydir } from "./fiyat-endeks-hesap";

const D = (v: string | number) => new Prisma.Decimal(v);
/** 2024-01'den itibaren her ay %2 artan endeks (100, 102, 104.04 ...). */
function seri(adet = 36) {
  const m = new Map<string, Prisma.Decimal>();
  let d = D(100);
  for (let i = 0; i < adet; i++) { m.set(ayKaydir("2024-01-01", i), d.toDecimalPlaces(6)); d = d.mul("1.02"); }
  return m;
}

describe("END-17 endeksli artış hesabı", () => {
  it("son ay artış ayından önceki aydır", () => {
    expect(artisSonAyi(2026, 1)).toBe("2025-12-01");
    expect(artisSonAyi(2026, 7)).toBe("2026-06-01");
  });
  it("yıllık değişim: son ay / 12 ay önce − 1; kullanılan iki dönem saklanır", () => {
    const h = artisHesapla("yillik", "2025-12-01", seri(), null)!;
    expect(h.hesaplananOran).toBe("26.82"); // 1,02^12 − 1
    expect(h.uygulananOran).toBe("26.82");
    expect(h.kullanilan.map((k) => k.ay)).toEqual(["2024-12-01", "2025-12-01"]);
  });
  it("on iki aylık ortalamalar: aynı sabit büyümede de %26,82; 24 ay saklanır", () => {
    const h = artisHesapla("oniki_ay_ortalama", "2025-12-01", seri(), null)!;
    expect(h.hesaplananOran).toBe("26.82");
    expect(h.kullanilan).toHaveLength(24);
    expect(h.ortalamalar).toBeDefined();
  });
  it("üst sınır kırpar; eksi oran sıfırlanır; eksik ay hesap üretmez", () => {
    expect(artisHesapla("yillik", "2025-12-01", seri(), D(25))).toMatchObject({ hesaplananOran: "26.82", uygulananOran: "25.00", kirpildi: true });
    const dusen = new Map([["2024-12-01", D(110)], ["2025-12-01", D(100)]]);
    expect(artisHesapla("yillik", "2025-12-01", dusen, null)).toMatchObject({ hesaplananOran: "-9.09", uygulananOran: "0.00" });
    expect(artisHesapla("yillik", "2027-06-01", seri(), null)).toBeNull();
  });
  it("yeni bedel kuruşa yuvarlanır", () => {
    expect(yeniBedel(D("15000"), "26.82").toFixed(2)).toBe("19023.00");
    expect(yeniBedel(D("999.99"), "33.33").toFixed(2)).toBe("1333.29");
  });
  it("öneri penceresi artış ayı ve ertesi aydır (Türkiye saati); aralık ayında ocak da pencerededir", () => {
    expect(oneriYili(7, new Date("2026-07-03T09:00:00+03:00"))).toBe(2026);
    expect(oneriYili(7, new Date("2026-08-31T23:00:00+03:00"))).toBe(2026);
    expect(oneriYili(7, new Date("2026-09-01T00:30:00+03:00"))).toBeNull();
    expect(oneriYili(7, new Date("2026-06-30T23:30:00+03:00"))).toBeNull();
    expect(oneriYili(12, new Date("2027-01-10T09:00:00+03:00"))).toBe(2026);
  });
});
