import { describe, expect, it } from "vitest";
import { BIRIMLER, VARSAYILAN_BIRIM_KODU, birimCoz, birimEtiketi, birimTanindiMi, birimUblKodu } from "./birim-kodu";

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

describe("BIRIMLER", () => {
  it("her seçeneğin ayrı bir GİB kodu vardır", () => {
    const kodlar = BIRIMLER.map((b) => birimUblKodu(b.ad));
    expect(BIRIMLER.every((b) => birimTanindiMi(b.ad))).toBe(true);
    expect(new Set(kodlar).size).toBe(kodlar.length);
  });

  it("serbest yazımı listedeki ada çevirir", () => {
    expect(birimCoz("Kg.")).toBe("kg");
    expect(birimCoz("lt")).toBe("litre");
    expect(birimCoz("tane")).toBe("adet");
    expect(birimCoz("M²")).toBe("m2");
    expect(birimCoz("takım")).toBe("set");
    expect(birimCoz("xyz")).toBeNull();
    expect(birimCoz("")).toBeNull();
  });

  it("etiket listede yoksa adı olduğu gibi verir", () => {
    expect(birimEtiketi("m2")).toBe("Metrekare (m²)");
    expect(birimEtiketi("bilinmez")).toBe("bilinmez");
  });
});
