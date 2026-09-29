import { describe, expect, it } from "vitest";
import { ilkKosullar, kosulSatirlari, teslimSekliGecerliMi, vadeTarihiHesapla } from "./teklif-kosullari";

describe("teklif koşulları (FTR-33)", () => {
  it("vade tarihini fatura tarihine gün ekleyerek bulur, ay/yıl geçişinde de", () => {
    expect(vadeTarihiHesapla("2026-09-29", 30)).toBe("2026-10-29");
    expect(vadeTarihiHesapla("2026-12-15", 20)).toBe("2027-01-04");
    expect(vadeTarihiHesapla("2026-09-29", 0)).toBe("2026-09-29");
    expect(vadeTarihiHesapla("2026-09-29", null)).toBeNull();
  });

  it("teslim şeklini Incoterms listesinden kabul eder", () => {
    expect(teslimSekliGecerliMi("FOB")).toBe(true);
    expect(teslimSekliGecerliMi(null)).toBe(true);
    expect(teslimSekliGecerliMi("XYZ")).toBe(false);
  });

  it("birleşen belgelerde her koşulun ilk dolusunu alır", () => {
    expect(ilkKosullar([{ teslimSuresi: " " }, { odemeVadeGun: 0, teslimSekli: "EXW" }, { odemeVadeGun: 30, teslimSuresi: "15 iş günü" }]))
      .toEqual({ odemeVadeGun: 0, teslimSuresi: "15 iş günü", teslimSekli: "EXW" });
  });

  it("okunur satırlar üretir, peşini ayrı yazar", () => {
    expect(kosulSatirlari({ odemeVadeGun: 30, teslimSuresi: "15 iş günü", teslimSekli: "FOB" }))
      .toEqual(["Ödeme: 30 gün vadeli", "Teslim süresi: 15 iş günü", "Teslim şekli: FOB — Gemide masrafsız teslim"]);
    expect(kosulSatirlari({ odemeVadeGun: 0 })).toEqual(["Ödeme: Peşin"]);
    expect(kosulSatirlari({})).toEqual([]);
  });
});
