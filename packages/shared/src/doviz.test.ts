import { describe, expect, it } from "vitest";
import { DOVIZ_ADLARI, DOVIZ_CINSLERI, SIK_DOVIZLER, YABANCI_DOVIZLER, dovizKoduMu } from "./doviz";

describe("döviz listesi (DVZ-10)", () => {
  it("TL başta, kodlar tekil ve hepsinin adı var", () => {
    expect(DOVIZ_CINSLERI[0]).toBe("TRY");
    expect(new Set(DOVIZ_CINSLERI).size).toBe(DOVIZ_CINSLERI.length);
    for (const d of DOVIZ_CINSLERI) expect(DOVIZ_ADLARI[d]).toBeTruthy();
    expect(YABANCI_DOVIZLER).not.toContain("TRY");
    for (const d of SIK_DOVIZLER) expect(DOVIZ_CINSLERI).toContain(d);
  });
  it("bilinmeyen kodu reddeder", () => {
    expect(dovizKoduMu("GBP")).toBe(true);
    expect(dovizKoduMu("XDR")).toBe(false);
    expect(dovizKoduMu("usd")).toBe(false);
  });
});
