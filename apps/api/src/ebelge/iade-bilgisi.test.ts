import { describe, expect, it } from "vitest";
import { ebelgeGonderilebilirTipMi, iadeOzeti } from "./iade-bilgisi";

describe("iade özeti (EBLG-58)", () => {
  it("yalnız satış ve alış iadesi e-belge olarak kesilir", () => {
    expect(ebelgeGonderilebilirTipMi("satis")).toBe(true);
    expect(ebelgeGonderilebilirTipMi("alis_iade")).toBe(true);
    for (const tip of ["alis", "satis_iade", "proforma"]) expect(ebelgeGonderilebilirTipMi(tip)).toBe(false);
  });

  it("satış faturasında iade alanı yoktur", () => {
    expect(iadeOzeti({ tip: "satis", tarih: new Date("2026-09-19"), iadeReferanslari: [] })).toEqual({ iade: false, referanslar: [], engeller: [] });
  });

  it("referanssız alış iadesini durdurur, referansları sırasıyla verir", () => {
    expect(iadeOzeti({ tip: "alis_iade", tarih: new Date("2026-09-19"), iadeReferanslari: [] }).engeller).toHaveLength(1);
    const ozet = iadeOzeti({
      tip: "alis_iade",
      tarih: new Date("2026-09-19"),
      iadeReferanslari: [
        { sira: 2, belgeNo: "ABC2026000000002", tarih: new Date("2026-09-11"), kaynakFaturaId: null },
        { sira: 1, belgeNo: "ABC2026000000001", tarih: new Date("2026-09-10"), kaynakFaturaId: "k-1" },
      ],
    });
    expect(ozet.engeller).toEqual([]);
    expect(ozet.referanslar.map((r) => r.belgeNo)).toEqual(["ABC2026000000001", "ABC2026000000002"]);
  });
});
