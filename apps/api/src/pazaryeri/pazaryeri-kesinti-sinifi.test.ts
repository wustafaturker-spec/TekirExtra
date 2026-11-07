import { describe, expect, it } from "vitest";
import { kesintiBaslangicDurumu, kesintiSinifiBul } from "./pazaryeri-kesinti-sinifi";

describe("PZR-06/08 kesinti sınıfı", () => {
  it("bilinen adlar sınıflanır; emin olunmayan sınıflandırılmamış kalır", () => {
    expect(["Commission", "Service Fee", "FBAPerUnitFulfillmentFee", "ShippingChargeback", "Kargo bedeli", "Reklam", "Komisyon"].map(kesintiSinifiBul)).toEqual(Array(7).fill("faturali"));
    expect(kesintiSinifiBul("TaxWithheld")).toBe("stopaj");
    expect(kesintiSinifiBul("COMMISSION")).toBe("faturali");
    expect(kesintiSinifiBul("STOPAJ")).toBe("stopaj");
    expect(kesintiSinifiBul("E-ticaret stopajı")).toBe("stopaj");
    expect(kesintiSinifiBul("Late shipment penalty")).toBe("ceza");
    expect(["Tax", "Promotion", "Amazon kesintisi", "Refund"].map(kesintiSinifiBul)).toEqual(Array(4).fill("siniflandirilmamis"));
  });

  it("faturasız sınıflar doğrudan faturasız, diğerleri bekliyor başlar", () => {
    expect(kesintiBaslangicDurumu("ceza")).toBe("faturasiz");
    expect(kesintiBaslangicDurumu("diger_faturasiz")).toBe("faturasiz");
    expect(kesintiBaslangicDurumu("faturali")).toBe("bekliyor");
    expect(kesintiBaslangicDurumu("stopaj")).toBe("bekliyor");
  });
});
