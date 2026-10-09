import { describe, expect, it, vi } from "vitest";
import { tevkifatTablosuCoz } from "@tekirextra/shared";
import { firmaTevkifatTablosu, tevkifatKurallariniUygula } from "./tevkifat-tablosu";

describe("firma tevkifat tablosu (FTR-35)", () => {
  it("ayardaki değişiklikleri varsayılanın üstüne bindirir", async () => {
    const ayarlar = { getir: vi.fn().mockResolvedValue({ degisiklikler: [{ kod: "601", oranlar: ["5/10"] }] }) };
    const tablo = await firmaTevkifatTablosu(ayarlar as never);
    expect(ayarlar.getir).toHaveBeenCalledWith("tevkifat", undefined);
    expect(tablo.find((k) => k.kod === "601")?.oranlar).toEqual(["5/10"]);
    expect((await firmaTevkifatTablosu(undefined)).find((k) => k.kod === "601")?.oranlar).toEqual(["4/10"]);
  });

  it("kod ve oran kuralını kiracının tablosuyla uygular", () => {
    const tablo = tevkifatTablosuCoz([{ kod: "604", pasif: true }, { kod: "628", ad: "YENİ", oranlar: ["3/10"] }]);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "628" }], tablo)).toEqual([]);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "699" }], tablo)[0]).toMatch(/1\. satır: Tanımsız/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "650" }], tablo)[0]).toMatch(/oranı seçilmelidir/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "650", tevkifatOrani: "4/10" }], tablo)[0]).toMatch(/geçersiz tevkifat oranı/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "604" }], tablo)[0]).toMatch(/pasif/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "604" }], tablo, true)).toEqual([]);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "601", tevkifatOrani: "3/10" }], tablo)).toEqual([]);
  });
});
