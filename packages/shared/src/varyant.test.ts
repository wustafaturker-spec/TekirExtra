import { describe, expect, it } from "vitest";
import { kodParcasi, varyantAciklamasi, varyantKombinasyonlari, varyantliAd, varyantliKod } from "./varyant";

describe("varyant adlandırma", () => {
  it("satır adı, kodu ve açıklaması varyanttan gelir", () => {
    const v = { kod: "TSH-001-SIYAH-M", ad: "Siyah / M", nitelikler: { Renk: "Siyah", Beden: "M" } };
    expect(varyantliAd("Tişört", v)).toBe("Tişört — Siyah / M");
    expect(varyantliKod("TSH-001", v)).toBe("TSH-001-SIYAH-M");
    expect(varyantAciklamasi(v)).toBe("Renk: Siyah, Beden: M");
    expect(varyantliAd("Tişört", null)).toBe("Tişört");
    expect(varyantliKod("TSH-001", null)).toBe("TSH-001");
    expect(varyantAciklamasi(null)).toBe("");
  });

  it("kod parçasında Türkçe harfler sadeleşir", () => {
    expect(kodParcasi("Açık Yeşil")).toBe("ACIK-YESIL");
    expect(kodParcasi("  ığüşöç İ  ")).toBe("IGUSOC-I");
    expect(kodParcasi("42/44")).toBe("42-44");
  });

  it("niteliklerin tüm kombinasyonlarını üretir", () => {
    const liste = varyantKombinasyonlari("tsh-001", [{ ad: "Renk", degerler: ["Siyah", "Beyaz", "Siyah"] }, { ad: "Beden", degerler: ["S", "M"] }, { ad: "", degerler: ["x"] }]);
    expect(liste.map((v) => v.kod)).toEqual(["TSH-001-SIYAH-S", "TSH-001-SIYAH-M", "TSH-001-BEYAZ-S", "TSH-001-BEYAZ-M"]);
    expect(liste[1]).toEqual({ kod: "TSH-001-SIYAH-M", ad: "Siyah / M", nitelikler: { Renk: "Siyah", Beden: "M" } });
    expect(varyantKombinasyonlari("X", [])).toEqual([]);
  });
});
