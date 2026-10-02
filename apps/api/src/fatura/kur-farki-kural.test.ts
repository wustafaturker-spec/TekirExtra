import { describe, expect, it } from "vitest";
import { icYuzdeMatrah, kurFarkiSatirlari, kurFarkiYonu } from "./kur-farki-kural";

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

describe("kur farkı fatura satırları", () => {
  it("aynı oran/istisna kodu tek satırda, mutlak değerle toplanır", () => {
    const satirlar = kurFarkiSatirlari([
      { kurFarkiTry: "60.00", kdvOrani: "20", gibIstisnaKodu: null },
      { kurFarkiTry: "-60.00", kdvOrani: "20.00", gibIstisnaKodu: null },
      { kurFarkiTry: "40.00", kdvOrani: "0", gibIstisnaKodu: "301" },
    ]);
    expect(satirlar).toHaveLength(2);
    expect(satirlar[0].kdvDahil.toFixed(2)).toBe("120.00");
    expect(satirlar[0].matrah.toFixed(2)).toBe("100.00");
    expect(satirlar[1]).toMatchObject({ gibIstisnaKodu: "301" });
    expect(satirlar[1].matrah.toFixed(2)).toBe("40.00");
  });
});
