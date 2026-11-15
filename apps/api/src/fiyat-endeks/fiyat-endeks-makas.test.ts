import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { aylikFiyat, makasDurumu, marjMakasi } from "./fiyat-endeks-makas.raporlar";

const D = (v: string) => new Prisma.Decimal(v);
const aylar = ["2026-01-01", "2026-02-01", "2026-03-01"];
const seri = (h: Record<string, string>) => (ay: string) => (h[ay] ? D(h[ay]) : null);

describe("END-13 marj makası", () => {
  it("ilk ve son ortak ay; makas = maliyet değişimi − satış değişimi; marj puanı", () => {
    const m = marjMakasi(aylar, seri({ "2026-01-01": "100", "2026-02-01": "105", "2026-03-01": "110" }), seri({ "2026-01-01": "60", "2026-03-01": "75" }))!;
    expect([m.bazAy, m.sonAy]).toEqual(["2026-01-01", "2026-03-01"]);
    expect(m.makas.toFixed(2)).toBe("15.00"); // %25 − %10
    expect([m.bazMarj.toFixed(2), m.sonMarj.toFixed(2), m.marjDegisim.toFixed(2)]).toEqual(["40.00", "31.82", "-8.18"]);
    expect(makasDurumu(m, 10)).toBe("Maliyet satış fiyatından hızlı arttı");
    expect(makasDurumu(m, 20)).toBe("Eşik içinde");
  });
  it("satış fiyatı değişmeden maliyet eşiği aşınca ayrı durum; ters makas", () => {
    const sabit = marjMakasi(aylar, seri({ "2026-01-01": "100", "2026-03-01": "100" }), seri({ "2026-01-01": "60", "2026-03-01": "70" }))!;
    expect(makasDurumu(sabit, 10)).toBe("Maliyet arttı, satış fiyatı güncellenmedi");
    const ters = marjMakasi(aylar, seri({ "2026-01-01": "100", "2026-03-01": "130" }), seri({ "2026-01-01": "60", "2026-03-01": "60" }))!;
    expect(makasDurumu(ters, 10)).toBe("Satış fiyatı maliyetten hızlı arttı");
  });
  it("ortak iki ay yoksa hesap yok; eşik altı ay fiyat sayılmaz", () => {
    expect(marjMakasi(aylar, seri({ "2026-01-01": "100", "2026-03-01": "110" }), seri({ "2026-02-01": "60" }))).toBeNull();
    expect(aylikFiyat({ tutar: D("100"), miktar: D("2"), satir: 1 }, 2)).toBeNull();
    expect(aylikFiyat({ tutar: D("100"), miktar: D("2"), satir: 1 }, 1)?.toString()).toBe("50");
  });
});
