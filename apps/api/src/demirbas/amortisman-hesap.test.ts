import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { amortismanPlani, araDonemTutari, azalanOran, cikisSonucu, eksikOncekiYillar, kkegHesapla } from "./amortisman-hesap";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const tutarlar = (p: ReturnType<typeof amortismanPlani>) => p.satirlar.map((s) => [s.yil, s.tutar.toFixed(2)]);

describe("amortismanPlani", () => {
  it("normal yöntemde edinme yılı tam yıl, son yıl kalanı kapatır", () => {
    const p = amortismanPlani({ bedel: D("10000"), edinmeTarihi: "2026-09-15", faydaliOmur: 3, yontem: "normal", binekOto: false });
    expect(tutarlar(p)).toEqual([[2026, "3333.33"], [2027, "3333.33"], [2028, "3333.34"]]);
    expect(p.satirlar.at(-1)!.birikmisSonra.toFixed(2)).toBe("10000.00");
  });

  it("azalan bakiyeler kalan değerden, oran en çok %50, son yıl kalan", () => {
    expect(azalanOran(3).toFixed(4)).toBe("0.5000");
    expect(azalanOran(5).toFixed(4)).toBe("0.4000");
    const p = amortismanPlani({ bedel: D("10000"), edinmeTarihi: "2026-01-10", faydaliOmur: 5, yontem: "azalan", binekOto: false });
    expect(tutarlar(p)).toEqual([[2026, "4000.00"], [2027, "2400.00"], [2028, "1440.00"], [2029, "864.00"], [2030, "1296.00"]]);
  });

  it("azalandan normale geçişte kalan değer kalan yıllara eşit bölünür", () => {
    const p = amortismanPlani({ bedel: D("10000"), edinmeTarihi: "2026-01-10", faydaliOmur: 5, yontem: "azalan", normaleGecisYili: 2028, binekOto: false });
    // 2026 4000, 2027 2400 → kalan 3600, üç yıla 1200
    expect(tutarlar(p)).toEqual([[2026, "4000.00"], [2027, "2400.00"], [2028, "1200.00"], [2029, "1200.00"], [2030, "1200.00"]]);
  });

  it("binek otoda ilk yıl kıst, kalan kısım ömrü izleyen yılda", () => {
    const p = amortismanPlani({ bedel: D("1200000"), edinmeTarihi: "2026-10-05", faydaliOmur: 5, yontem: "normal", binekOto: true });
    // yıllık 240.000; Ekim–Aralık 3 ay → 60.000; 2027–2030 240.000; 2031 kalan 180.000
    expect(tutarlar(p)).toEqual([[2026, "60000.00"], [2027, "240000.00"], [2028, "240000.00"], [2029, "240000.00"], [2030, "240000.00"], [2031, "180000.00"]]);
  });

  it("binek oto Ocak'ta alınırsa kıst yoktur", () => {
    const p = amortismanPlani({ bedel: D("500000"), edinmeTarihi: "2026-01-20", faydaliOmur: 5, yontem: "normal", binekOto: true });
    expect(p.satirlar).toHaveLength(5);
    expect(p.satirlar[0].tutar.toFixed(2)).toBe("100000.00");
  });

  it("binek oto sınırını aşan kısım KKEG", () => {
    expect(kkegHesapla(D("400000"), D("2000000"), 1380000).toFixed(2)).toBe("124000.00");
    expect(kkegHesapla(D("400000"), D("1000000"), 1380000).toFixed(2)).toBe("0.00");
    const p = amortismanPlani({ bedel: D("2000000"), edinmeTarihi: "2026-01-02", faydaliOmur: 5, yontem: "normal", binekOto: true, binekSiniri: 1380000 });
    expect(p.satirlar[0].kkeg.toFixed(2)).toBe("124000.00");
  });

  it("açılış kaydında plan açılışın son yılını izleyen yıldan sürer", () => {
    const p = amortismanPlani({ bedel: D("10000"), edinmeTarihi: "2023-05-01", faydaliOmur: 5, yontem: "normal", binekOto: false, acilis: { birikmis: D("6000"), sonYil: 2025 } });
    expect(p.ilkYil).toBe(2026);
    expect(tutarlar(p)).toEqual([[2026, "2000.00"], [2027, "2000.00"]]);
  });

  it("kesin yıllar kayıttan alınır, fark son yılda kapanır", () => {
    const p = amortismanPlani({
      bedel: D("10000"), edinmeTarihi: "2026-01-01", faydaliOmur: 4, yontem: "normal", binekOto: false,
      kesinler: new Map([[2026, D("2400")]]),
    });
    expect(tutarlar(p)).toEqual([[2026, "2400.00"], [2027, "2500.00"], [2028, "2500.00"], [2029, "2600.00"]]);
    expect(p.satirlar[0].durum).toBe("kesin");
    expect(eksikOncekiYillar(p, 2028)).toEqual([2027]);
  });

  it("elden çıkış yılında ve sonrasında amortisman ayrılmaz", () => {
    const p = amortismanPlani({ bedel: D("10000"), edinmeTarihi: "2026-01-01", faydaliOmur: 5, yontem: "normal", binekOto: false, cikisYili: 2028 });
    expect(p.satirlar.map((s) => s.yil)).toEqual([2026, 2027]);
  });

  it("tamamen itfa edilmiş açılış kartının planı boştur", () => {
    const p = amortismanPlani({ bedel: D("5000"), edinmeTarihi: "2019-01-01", faydaliOmur: 5, yontem: "normal", binekOto: false, acilis: { birikmis: D("5000"), sonYil: 2023 } });
    expect(p.satirlar).toEqual([]);
  });
});

describe("yardımcılar", () => {
  it("ara dönem tutarı geçen çeyrek oranıdır", () => {
    expect(araDonemTutari(D("1000"), 3).toFixed(2)).toBe("750.00");
  });
  it("satış kârı/zararı net defter değerine göre", () => {
    const s = cikisSonucu(D("10000"), D("7000"), D("2500"));
    expect(s.netDeger.toFixed(2)).toBe("3000.00");
    expect(s.fark.toFixed(2)).toBe("-500.00");
  });
});
