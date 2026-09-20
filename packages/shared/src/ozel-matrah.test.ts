import { describe, expect, it } from "vitest";
import { ozelMatrahHatalari, ozelMatrahKdvsi } from "./ozel-matrah";

const temel = { tip: "satis", ozelMatrahKodu: "812", ozelMatrahTutari: "5000", ozelMatrahOrani: "20", genelToplam: "250000", satirlar: [{ kdvOrani: 0 }] };

describe("ozelMatrahHatalari", () => {
  it("kod seçilmemişse kural işlemez", () => {
    expect(ozelMatrahHatalari({ ...temel, ozelMatrahKodu: null, satirlar: [{ kdvOrani: 20 }] })).toEqual([]);
  });

  it("geçerli ikinci el satışında engel yok", () => {
    expect(ozelMatrahHatalari(temel)).toEqual([]);
  });

  it("KDV'li ya da tevkifatlı satırı, aşan matrahı ve alış iadesini reddeder", () => {
    expect(ozelMatrahHatalari({ ...temel, satirlar: [{ kdvOrani: 20 }] })[0]).toMatch(/KDV oranı sıfır olmalıdır/);
    expect(ozelMatrahHatalari({ ...temel, satirlar: [{ kdvOrani: 0, tevkifatKodu: "601" }] })[0]).toMatch(/tevkifatlı satır/);
    expect(ozelMatrahHatalari({ ...temel, ozelMatrahTutari: "300000" })[0]).toMatch(/satış bedelini aşamaz/);
    expect(ozelMatrahHatalari({ ...temel, tip: "alis_iade" })[0]).toMatch(/yalnız satış faturasında/);
  });

  it("tutar varken oran ister, tanımsız kodu reddeder", () => {
    expect(ozelMatrahHatalari({ ...temel, ozelMatrahOrani: "0" })[0]).toMatch(/KDV oranı girilmelidir/);
    expect(ozelMatrahHatalari({ ...temel, ozelMatrahKodu: "899" })[0]).toMatch(/Tanımsız özel matrah kodu/);
    // Bayi işlerinde matrah sıfır olabilir: oran aranmaz.
    expect(ozelMatrahHatalari({ ...temel, ozelMatrahKodu: "806", ozelMatrahTutari: "0", ozelMatrahOrani: "0" })).toEqual([]);
  });

  it("KDV'yi matrah ve orandan kuruşta hesaplar", () => {
    expect(ozelMatrahKdvsi("5000", "20")).toBe(1000);
    expect(ozelMatrahKdvsi("22.28", "18")).toBe(4.01);
    expect(ozelMatrahKdvsi(null, "20")).toBe(0);
  });
});
