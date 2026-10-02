import { describe, expect, it } from "vitest";
import { bordroNoBicimle, ortalamaVade, siradakiPortfoyNolari } from "./cek-bordro-hesap";

describe("çek bordrosu hesapları (KSB-11)", () => {
  it("ortalama vade tutar ağırlıklıdır", () => {
    // 10.000 TL 31 Ekim, 30.000 TL 30 Kasım → 30 günlük farkın 3/4'ü: 22,5 gün → 23 Kasım (yuvarlama)
    expect(ortalamaVade([{ vadeTarihi: "2026-10-31", tutar: "10000" }, { vadeTarihi: "2026-11-30", tutar: "30000" }])).toBe("2026-11-23");
    expect(ortalamaVade([{ vadeTarihi: "2026-12-15", tutar: "500" }])).toBe("2026-12-15");
    // Eşit tutarlar tam ortaya düşer.
    expect(ortalamaVade([{ vadeTarihi: "2026-01-01", tutar: "100" }, { vadeTarihi: "2026-01-11", tutar: "100" }])).toBe("2026-01-06");
  });

  it("bordro numarası yıl ve altı haneli sıradır", () => {
    expect(bordroNoBicimle(2026, 7)).toBe("BRD2026-000007");
  });

  it("portföy numarası rakamlı numaraların en büyüğünden sürer, harfli numaraları atlar", () => {
    expect(siradakiPortfoyNolari(["0007", "P-12", "0003"], 3)).toEqual(["0008", "0009", "0010"]);
    expect(siradakiPortfoyNolari([], 2)).toEqual(["0001", "0002"]);
    expect(siradakiPortfoyNolari(["CEK-1"], 1)).toEqual(["0001"]);
  });
});
