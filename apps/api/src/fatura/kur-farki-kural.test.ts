import { describe, expect, it } from "vitest";
import { icYuzdeMatrah, kurFarkiSatirlari, kurFarkiYonu, matrahBul } from "./kur-farki-kural";

describe("kur farkı yönü", () => {
  it("tahsilatta artı fark lehimize, faturayı biz keseriz", () => {
    expect(kurFarkiYonu("tahsilat", "76.71")).toBe("biz_keseriz");
    expect(kurFarkiYonu("tahsilat", "-12.00")).toBe("karsi_taraf_keser");
  });

  it("ödemede eksi fark lehimize, artı fark karşı tarafın faturası", () => {
    expect(kurFarkiYonu("tediye", "-5.10")).toBe("biz_keseriz");
    expect(kurFarkiYonu("tediye", "76.71")).toBe("karsi_taraf_keser");
  });
});

describe("iç yüzde matrah", () => {
  it("matrah + kuruşa yuvarlanmış KDV, KDV dahil tutara eşittir", () => {
    for (const [tutar, oran] of [["76.70", "20"], ["100.00", "20"], ["0.05", "20"], ["1234.57", "10"], ["33.33", "1"], ["10.01", "18"]]) {
      const m = icYuzdeMatrah(tutar, oran);
      const kdv = m.mul(oran).div(100).toDecimalPlaces(2);
      expect(m.add(kdv).toFixed(2)).toBe(tutar);
    }
  });

  it("tutturulamayan tutarda (76,71 / %20) fark en çok 1 kuruştur", () => {
    const m = icYuzdeMatrah("76.71", "20");
    const toplam = m.add(m.mul("0.2").toDecimalPlaces(2));
    expect(toplam.sub("76.71").abs().lte("0.01")).toBe(true);
  });

  it("KDV'siz (istisna) satırda matrah tutarın kendisidir", () => {
    expect(icYuzdeMatrah("250.40", "0").toFixed(2)).toBe("250.40");
  });
});

const grup = (kdvOrani: string, agirlik: string, ek: { istisna?: string; tevkifatKodu?: string; tevkifatOrani?: string } = {}) =>
  ({ kdvOrani, gibIstisnaKodu: ek.istisna ?? null, tevkifatKodu: ek.tevkifatKodu ?? null, tevkifatOrani: ek.tevkifatOrani ?? "0", agirlik });

describe("kur farkı fatura satırları (KSB-27)", () => {
  it("aynı oran/istisna kodu tek satırda, mutlak değerle toplanır", () => {
    const satirlar = kurFarkiSatirlari([
      { kurFarkiTry: "60.00", gruplar: [grup("20", "1")] },
      { kurFarkiTry: "-60.00", gruplar: [grup("20.00", "1")] },
      { kurFarkiTry: "40.00", gruplar: [grup("0", "1", { istisna: "301" })] },
    ]);
    expect(satirlar).toHaveLength(2);
    expect(satirlar[0].kdvDahil.toFixed(2)).toBe("120.00");
    expect(satirlar[0].matrah.toFixed(2)).toBe("100.00");
    expect(satirlar[1]).toMatchObject({ gibIstisnaKodu: "301" });
    expect(satirlar[1].matrah.toFixed(2)).toBe("40.00");
  });

  it("çok oranlı faturada fark ödenecek tutar ağırlığıyla bölünür", () => {
    // %20'lik 1000 (ödenecek 1200) ve %10'luk 1000 (ödenecek 1100) matrah.
    const satirlar = kurFarkiSatirlari([{ kurFarkiTry: "230.00", gruplar: [grup("20", "1200"), grup("10", "1100")] }]);
    expect(satirlar.map((s) => [s.kdvOrani.toFixed(0), s.kdvDahil.toFixed(2), s.matrah.toFixed(2)])).toEqual([["20", "120.00", "100.00"], ["10", "110.00", "100.00"]]);
  });

  it("tevkifatlı grupta matrah, ödenecek tutar (matrah + KDV − tevkifat) tutacak biçimde bulunur", () => {
    // %20 KDV, 5/10 tevkifat: 100 matrah → 20 KDV → 10 tevkifat → ödenecek 110.
    const [s] = kurFarkiSatirlari([{ kurFarkiTry: "110.00", gruplar: [grup("20", "1", { tevkifatKodu: "601", tevkifatOrani: "0.5" })] }]);
    expect(s).toMatchObject({ tevkifatKodu: "601" });
    expect(s.matrah.toFixed(2)).toBe("100.00");
    expect(matrahBul("110.00", "20", "0.5").toFixed(2)).toBe("100.00");
  });
});
