import { describe, expect, it } from "vitest";
import { ayEkle, krediPlaniHesapla, rotatifFaizOnerisi, yillikFaizKarsiligi } from "./kredi";

const topla = (x: number[]) => Math.round(x.reduce((t, v) => t + v, 0) * 100) / 100;

describe("kredi ödeme planı (KRD-02)", () => {
  it("eşit taksitte toplam taksit sabit, anapara tam kapanır; faiz kalan anapara × aylık oran", () => {
    const plan = krediPlaniHesapla({ tur: "taksitli", planTuru: "esit_taksit", anapara: 100_000, aylikFaiz: 3, bsmvOrani: 5, kkdfOrani: 0, kullanimTarihi: "2026-01-15", taksitSayisi: 12, ilkTaksitTarihi: "2026-02-15" });
    expect(plan).toHaveLength(12);
    expect(topla(plan.map((p) => p.anapara))).toBe(100_000);
    expect(plan[0]).toMatchObject({ vadeTarihi: "2026-02-15", faiz: 3000, bsmv: 150, kkdf: 0 });
    const ilkTaksit = plan[0].toplam;
    for (const p of plan.slice(0, 11)) expect(Math.abs(p.toplam - ilkTaksit)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(plan[11].toplam - ilkTaksit)).toBeLessThan(1);
    expect(plan[11].vadeTarihi).toBe("2027-01-15");
  });

  it("eşit anaparada anapara sabit, faiz azalır", () => {
    const plan = krediPlaniHesapla({ tur: "taksitli", planTuru: "esit_anapara", anapara: 12_000, aylikFaiz: 2, bsmvOrani: 5, kkdfOrani: 0, kullanimTarihi: "2026-01-31", taksitSayisi: 3 });
    expect(plan.map((p) => p.anapara)).toEqual([4000, 4000, 4000]);
    expect(plan.map((p) => p.faiz)).toEqual([240, 160, 80]);
    expect(plan.map((p) => p.vadeTarihi)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("spot kredide tek ödeme, faiz gün / 30 ile", () => {
    const [p] = krediPlaniHesapla({ tur: "spot", anapara: 50_000, aylikFaiz: 3, bsmvOrani: 5, kkdfOrani: 0, kullanimTarihi: "2026-03-01", vadeTarihi: "2026-04-15" });
    expect(p).toMatchObject({ anapara: 50_000, faiz: 2250, bsmv: 112.5, toplam: 52_362.5 });
  });

  it("ay ekleme ay sonuna kırpar; yıllık karşılık", () => {
    expect(ayEkle("2026-01-31", 1)).toBe("2026-02-28");
    expect(ayEkle("2028-01-31", 1)).toBe("2028-02-29");
    expect(ayEkle("2026-11-15", 3)).toBe("2027-02-15");
    expect(yillikFaizKarsiligi(3)).toEqual({ nominal: 36, efektif: 42.58 });
  });
});

describe("rotatif faiz önerisi (KRD-04)", () => {
  it("günlük bakiyeyi aylık oran / 30 ile faizler", () => {
    // 1-10 Mart 100.000, 11-31 Mart 40.000 (10 + 21 gün), aylık %3
    const o = rotatifFaizOnerisi([{ tarih: "2026-02-20", anaparaDegisimi: 100_000 }, { tarih: "2026-03-11", anaparaDegisimi: -60_000 }], "2026-03-01", "2026-04-01", 3, 5, 0);
    expect(o.faiz).toBe(Math.round((100_000 * 10 + 40_000 * 21) * 0.03 / 30 * 100) / 100);
    expect(o.bsmv).toBe(Math.round(o.faiz * 5) / 100);
  });
});
