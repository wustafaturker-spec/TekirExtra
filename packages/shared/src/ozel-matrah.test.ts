import { describe, expect, it } from "vitest";
import { ozelMatrahHatalari, ozelMatrahKdvsi, ozelMatrahSatirPaylari, ozelMatrahTabani } from "./ozel-matrah";

const temel = { tip: "satis", ozelMatrahKodu: "812", ozelMatrahTutari: "5000", ozelMatrahOrani: "20", satisBedeli: "250000", satirlar: [{ kdvOrani: 0 }] };

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
    expect(ozelMatrahHatalari({ ...temel, tip: "alis_iade" })[0]).toMatch(/yalnız satış ve alış faturasında/);
    // EBLG-116: gelen özel matrah belgesi alışa işlenir.
    expect(ozelMatrahHatalari({ ...temel, tip: "alis" })).toEqual([]);
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

describe("ozelMatrahTabani", () => {
  it("KDV dahil kâr farkından matrahı iç yüzdeyle çözer", () => {
    // Saha örneği: 92.000'e alınıp 95.500'e satılan araç → fark 3.500, %1.
    expect(ozelMatrahTabani("3500", "1")).toBe(3465.35);
    expect(ozelMatrahKdvsi(ozelMatrahTabani("3500", "1"), "1")).toBe(34.65);
    expect(ozelMatrahTabani("", "20")).toBe(0);
  });
});

describe("ozelMatrahSatirPaylari", () => {
  it("tek satırda matrahın ve KDV'nin tamamını verir", () => {
    expect(ozelMatrahSatirPaylari([95465.35], "3465.35", "1")).toEqual([{ matrah: 3465.35, kdv: 34.65 }]);
  });

  it("çok satırda tutara göre böler, kuruş farkını son satıra bırakır", () => {
    const paylar = ozelMatrahSatirPaylari([100, 200], "10.01", "20");
    expect(paylar).toEqual([{ matrah: 3.34, kdv: 0.67 }, { matrah: 6.67, kdv: 1.33 }]);
    // Satır toplamları belge düzeyindeki tutarları birebir tutmalı.
    expect(paylar.reduce((t, p) => t + p.matrah, 0)).toBeCloseTo(10.01, 2);
    expect(paylar.reduce((t, p) => t + p.kdv, 0)).toBeCloseTo(ozelMatrahKdvsi("10.01", "20"), 2);
  });
});
