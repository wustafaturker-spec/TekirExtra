import { describe, expect, it } from "vitest";
import { dorseSchemeId, plakaGecerliMi, plakaNormalize, plakaSchemeId, plakaTuru } from "./plaka";

describe("plaka kuralları (şematron 14.09.2026 §3)", () => {
  it("boşlukları atar ve büyütür", () => {
    expect(plakaNormalize("34 abc 123")).toBe("34ABC123");
    expect(plakaNormalize("  06 iz 07 ")).toBe("06İZ07");
    expect(plakaNormalize(null)).toBe("");
  });

  it("Türkiye plakasını tanır", () => {
    for (const plaka of ["01ADS123", "34ABC123", "81Z1", "06AB1234"]) {
      expect(plakaTuru(plaka), plaka).toBe("tr");
    }
  });

  it("il kodu 01-81 dışındaysa Türkiye plakası saymaz", () => {
    // 82 diye bir il yok; kalan karakterler yabancı kümesine uyduğu için
    // belge reddedilmesin diye yabancı plaka olarak yazılır.
    expect(plakaTuru("82ABC123")).toBe("yabanci");
    expect(plakaTuru("00ABC123")).toBe("yabanci");
  });

  it("yabancı plakayı tanır", () => {
    expect(plakaTuru("AFK-159")).toBe("yabanci");
    expect(plakaTuru("BG_1234")).toBe("yabanci");
  });

  it("kalıba uymayan plakayı reddeder", () => {
    // Boşluk normalize edildiği için "34 ABC 123" geçerlidir; nokta ve
    // küçük harf dışı işaretler geçersizdir.
    expect(plakaTuru("34.ABC.123")).toBeNull();
    expect(plakaTuru("34 ABC+123")).toBeNull();
    expect(plakaGecerliMi("")).toBe(false);
    expect(plakaGecerliMi("34 ABC 123")).toBe(true);
  });

  it("schemeID'yi türe göre seçer", () => {
    expect(plakaSchemeId("34ABC123")).toBe("PLAKA");
    expect(plakaSchemeId("AFK-159")).toBe("YABANCIPLAKA");
    expect(dorseSchemeId("34DR4088")).toBe("DORSEPLAKA");
    expect(dorseSchemeId("AFK-159")).toBe("YABANCIDORSEPLAKA");
  });
});
