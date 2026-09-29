import { describe, expect, it } from "vitest";
import { ilgiliKisiMetni, ilgiliKisiTemizle, ilkIlgiliKisi } from "./ilgili-kisi";

describe("ilgili kişi (FTR-32)", () => {
  it("boşlukları kırpar, adsız görevi düşürür", () => {
    expect(ilgiliKisiTemizle({ ilgiliKisi: "  Ayşe Kaya ", ilgiliKisiGorevi: " Satınalma " })).toEqual({ ilgiliKisi: "Ayşe Kaya", ilgiliKisiGorevi: "Satınalma" });
    expect(ilgiliKisiTemizle({ ilgiliKisi: " ", ilgiliKisiGorevi: "Satınalma" })).toEqual({ ilgiliKisi: null, ilgiliKisiGorevi: null });
  });

  it("metni görevle ya da yalnız adla verir", () => {
    expect(ilgiliKisiMetni({ ilgiliKisi: "Ayşe Kaya", ilgiliKisiGorevi: "Satınalma" })).toBe("Ayşe Kaya (Satınalma)");
    expect(ilgiliKisiMetni({ ilgiliKisi: "Ayşe Kaya" })).toBe("Ayşe Kaya");
    expect(ilgiliKisiMetni({})).toBeNull();
  });

  it("birleşen belgelerde ilk dolu kişiyi göreviyle alır", () => {
    expect(ilkIlgiliKisi([{ ilgiliKisiGorevi: "Depo" }, { ilgiliKisi: "Ali Er", ilgiliKisiGorevi: "Satınalma" }, { ilgiliKisi: "Can" }]))
      .toEqual({ ilgiliKisi: "Ali Er", ilgiliKisiGorevi: "Satınalma" });
  });
});
