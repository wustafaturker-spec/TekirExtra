import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ayAraligi, ayBasiMetni, ayKaydir, endeksNormalle, fiyatSerisiHesapla, type AylikToplam } from "./fiyat-endeks-hesap";

const D = (v: string | number) => new Prisma.Decimal(v);
/** fiyat × miktar tutarında, `satir` satırlı ay. */
const ay = (fiyat: string, miktar = "10", satir = 3): AylikToplam => ({ tutar: D(fiyat).mul(miktar), miktar: D(miktar), satir });
const harita = <T>(g: Record<string, T>) => new Map(Object.entries(g));

describe("ay yardımcıları", () => {
  it("ay kaydırır ve yıl sınırını geçer", () => {
    expect(ayKaydir("2026-01-01", -1)).toBe("2025-12-01");
    expect(ayKaydir("2025-11-01", 14)).toBe("2027-01-01");
  });
  it("aralığı iki uç dahil üretir, ters aralıkta boş döner", () => {
    expect(ayAraligi("2025-11-01", "2026-02-01")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(ayAraligi("2026-02-01", "2026-01-01")).toEqual([]);
  });
  it("ay metnini doğrular", () => {
    expect(ayBasiMetni("2026-10")).toBe("2026-10-01");
    expect(ayBasiMetni("2026-10-17")).toBe("2026-10-01");
    expect(ayBasiMetni("2026-13")).toBeNull();
    expect(ayBasiMetni("")).toBeNull();
  });
});

describe("fiyatSerisiHesapla", () => {
  const aylar = ["2026-01-01", "2026-02-01", "2026-03-01"];

  it("reel değişimi ve endekse göre fiyatı hesaplar", () => {
    const toplam = harita({ "2026-01-01": ay("100"), "2026-02-01": ay("110"), "2026-03-01": ay("120") });
    const tufe = harita({ "2026-01-01": D(200), "2026-02-01": D(220), "2026-03-01": D(250) });
    const { satirlar, karsilastirmalar } = fiyatSerisiHesapla(toplam, aylar, "2026-01-01", new Map([["TUFE", tufe]]));
    expect(satirlar.map((s) => s.fiyat)).toEqual(["100.0000", "110.0000", "120.0000"]);
    expect(satirlar.map((s) => s.endeks100)).toEqual(["100.00", "110.00", "120.00"]);
    expect(satirlar[1].aylikDegisim).toBe("10.00");
    const k = karsilastirmalar[0];
    expect(k).toMatchObject({ endeks: "TUFE", sonAy: "2026-03-01", fiyatDegisim: "20.00", endeksDegisim: "25.00", olmasiGerekenFiyat: "125.0000", fark: "-5.0000", neden: null });
    // (1,20 / 1,25) − 1 = −0,04
    expect(k.reelDegisim).toBe("-4.00");
  });

  it("ağırlıklı ortalama: farklı miktarlı aylar tutar/miktardır", () => {
    const toplam = harita({ "2026-01-01": { tutar: D(1000 + 300), miktar: D(10 + 2), satir: 2 } });
    const { satirlar } = fiyatSerisiHesapla(toplam, ["2026-01-01"], "2026-01-01", new Map());
    expect(satirlar[0].fiyat).toBe("108.3333");
  });

  it("en az satır eşiğinin altındaki ay yetersizdir ve fiyat taşınmaz", () => {
    const toplam = harita({ "2026-01-01": ay("100"), "2026-02-01": ay("500", "1", 1) });
    const { satirlar } = fiyatSerisiHesapla(toplam, aylar, "2026-01-01", new Map());
    expect(satirlar[1]).toMatchObject({ durum: "yetersiz", fiyat: null, satir: 1 });
    expect(satirlar[2]).toMatchObject({ durum: "yok", fiyat: null });
  });

  it("baz ay yetersizse karşılaştırma yapılmaz, nedeni yazılır", () => {
    const toplam = harita({ "2026-01-01": ay("100", "1", 1), "2026-03-01": ay("120") });
    const { karsilastirmalar } = fiyatSerisiHesapla(toplam, aylar, "2026-01-01", new Map([["TUFE", harita({ "2026-01-01": D(1), "2026-03-01": D(2) })]]));
    expect(karsilastirmalar[0].reelDegisim).toBeNull();
    expect(karsilastirmalar[0].neden).toMatch(/Baz ayda yeterli veri yok/);
  });

  it("açıklanmamış son ay atlanır, karşılaştırma son açıklanan aya kadar yapılır", () => {
    const toplam = harita({ "2026-01-01": ay("100"), "2026-02-01": ay("105"), "2026-03-01": ay("130") });
    const tufe = harita({ "2026-01-01": D(100), "2026-02-01": D(110) });
    const k = fiyatSerisiHesapla(toplam, aylar, "2026-01-01", new Map([["TUFE", tufe]])).karsilastirmalar[0];
    expect(k.sonAy).toBe("2026-02-01");
    expect(k.fiyatDegisim).toBe("5.00");
  });

  it("baz ay endeksi yoksa nedeni yazılır", () => {
    const toplam = harita({ "2026-01-01": ay("100"), "2026-02-01": ay("105") });
    const k = fiyatSerisiHesapla(toplam, aylar, "2026-01-01", new Map([["USD", harita({ "2026-02-01": D(40) })]])).karsilastirmalar[0];
    expect(k.neden).toMatch(/Baz ay için endeks/);
  });

  it("yıllık değişim ekran dışındaki 12 ay öncesinden hesaplanır", () => {
    const toplam = harita({ "2025-01-01": ay("80"), "2026-01-01": ay("100") });
    const { satirlar } = fiyatSerisiHesapla(toplam, ["2026-01-01"], "2026-01-01", new Map());
    expect(satirlar[0].yillikDegisim).toBe("25.00");
  });

  it("büyük tutarda hassasiyet kaybetmez", () => {
    const toplam = harita({ "2026-01-01": { tutar: D("123456789012.3456"), miktar: D("3"), satir: 5 } });
    expect(fiyatSerisiHesapla(toplam, ["2026-01-01"], "2026-01-01", new Map()).satirlar[0].fiyat).toBe("41152263004.1152");
  });
});

describe("endeksNormalle", () => {
  it("baz ayı 100 yapar, boş ayı null bırakır", () => {
    const r = endeksNormalle(harita({ "2026-01-01": D(200), "2026-03-01": D(230) }), ["2026-01-01", "2026-02-01", "2026-03-01"], "2026-01-01");
    expect(r.map((x) => x.normal)).toEqual(["100.00", null, "115.00"]);
  });
});
