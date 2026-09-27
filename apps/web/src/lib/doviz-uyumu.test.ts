import { describe, expect, it } from "vitest";
import { dovizUyumsuzlugu, fiyatCevir, paraBicimi, paraBirimiEtiketi } from "./doviz-uyumu";

describe("döviz uyumu (FTR-28)", () => {
  it("TRY'yi TL, diğerlerini kodla gösterir", () => {
    expect(paraBirimiEtiketi("TRY")).toBe("TL");
    expect(paraBirimiEtiketi("USD")).toBe("USD");
    expect(paraBicimi(1234.5, "EUR")).toBe("1.234,50 EUR");
    expect(paraBicimi("10")).toBe("10,00 TL");
  });

  it("fiyat dövizi belgeninkinden farklıysa uyarı üretir, aynıysa üretmez", () => {
    expect(dovizUyumsuzlugu("USD", "TRY")).toContain("Ürünün fiyatı USD, belge TL");
    expect(dovizUyumsuzlugu("TRY", "TRY")).toBeUndefined();
    expect(dovizUyumsuzlugu(null, "TRY")).toBeUndefined();
    expect(dovizUyumsuzlugu(undefined, "EUR")).toContain("Ürünün fiyatı TL, belge EUR");
  });

  it("kalem fiyatını kurlar üzerinden çevirir", () => {
    expect(fiyatCevir(487.9, 1, 48.79)).toBe(10);
    expect(fiyatCevir(10, 48.79, 1)).toBe(487.9);
    expect(fiyatCevir(100, 48.79, 56.5)).toBeCloseTo(86.3540, 4);
    expect(() => fiyatCevir(10, 0, 1)).toThrow();
  });
});
