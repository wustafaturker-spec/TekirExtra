import { describe, expect, it } from "vitest";
import { VARSAYILAN_BIRIM_KODU, birimTanindiMi, birimUblKodu } from "./birim-kodu";

describe("birimUblKodu", () => {
  it("yaygın birimleri GİB koduna çevirir", () => {
    expect(birimUblKodu("adet")).toBe("C62");
    expect(birimUblKodu("kg")).toBe("KGM");
    expect(birimUblKodu("litre")).toBe("LTR");
    expect(birimUblKodu("metre")).toBe("MTR");
    expect(birimUblKodu("saat")).toBe("HUR");
    expect(birimUblKodu("ton")).toBe("TNE");
  });

  it("yazım farklarını aynı koda indirger", () => {
    for (const yazim of ["KG", "Kg.", " kg ", "kilogram"]) {
      expect(birimUblKodu(yazim), yazim).toBe("KGM");
    }
    expect(birimUblKodu("M²")).toBe("MTK");
    expect(birimUblKodu("m3")).toBe("MTQ");
    expect(birimUblKodu("ÇİFT")).toBe("PR");
  });

  it("tanınmayan birim adet sayılır ama tanınmadığı bilinir", () => {
    expect(birimUblKodu("zımbırtı")).toBe(VARSAYILAN_BIRIM_KODU);
    expect(birimTanindiMi("zımbırtı")).toBe(false);
    expect(birimTanindiMi("kg")).toBe(true);
  });

  it("boş birimde varsayılanı verir", () => {
    expect(birimUblKodu(null)).toBe("C62");
    expect(birimUblKodu("")).toBe("C62");
    expect(birimTanindiMi(null)).toBe(false);
  });
});
