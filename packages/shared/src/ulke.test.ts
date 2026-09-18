import { describe, expect, it } from "vitest";
import { ulkeAdi, ulkeKoduCoz, yurtDisiMi } from "./ulke";

describe("ulkeKoduCoz", () => {
  it("iki harfli kodu olduğu gibi büyütür", () => {
    expect(ulkeKoduCoz("de")).toBe("DE");
    expect(ulkeKoduCoz(" tr ")).toBe("TR");
    // Listede olmayan bir kod da geçerlidir; ad boş kalır, kod yazılır.
    expect(ulkeKoduCoz("ZW")).toBe("ZW");
    expect(ulkeAdi("ZW")).toBeUndefined();
  });

  it("Türkçe ülke adını koda çevirir", () => {
    expect(ulkeKoduCoz("Türkiye")).toBe("TR");
    expect(ulkeKoduCoz("turkiye")).toBe("TR");
    expect(ulkeKoduCoz("ALMANYA")).toBe("DE");
    expect(ulkeKoduCoz("Birleşik Arap Emirlikleri")).toBe("AE");
  });

  it("çözemediğini uydurmaz", () => {
    expect(ulkeKoduCoz("Zımbırtistan")).toBeUndefined();
    expect(ulkeKoduCoz("")).toBeUndefined();
    expect(ulkeKoduCoz(null)).toBeUndefined();
  });
});

describe("yurtDisiMi", () => {
  it("yalnız çözülebilen ve TR olmayan ülkede doğrudur", () => {
    expect(yurtDisiMi("TR")).toBe(false);
    expect(yurtDisiMi("Türkiye")).toBe(false);
    expect(yurtDisiMi(null)).toBe(false);
    expect(yurtDisiMi("Zımbırtistan")).toBe(false);
    expect(yurtDisiMi("DE")).toBe(true);
  });
});
