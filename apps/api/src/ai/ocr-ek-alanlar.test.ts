import { describe, expect, it } from "vitest";
import { fisFaturaOcrSonucSemasi } from "./ai.semalar";

const temel = { belgeTuru: "FIS", saticiUnvan: "Opet", toplamKdv: 200, toplamMatrah: 1000, genelToplam: 1200 };

describe("OCR ek alanları (CNL-21/22) belgeyi düşürmez", () => {
  it("model biçimleri normalize edilir", () => {
    const v = fisFaturaOcrSonucSemasi.parse({ ...temel, plaka: " 34 ABC 123 ", litre: "41,23 LT", odemeSekli: "KREDİ KARTI", kartSonDort: "5521 **** **** 9876" });
    expect(v).toMatchObject({ plaka: "34 ABC 123", litre: 41.23, odemeSekli: "kart", kartSonDort: "9876" });
    expect(fisFaturaOcrSonucSemasi.parse({ ...temel, odemeSekli: "NAKİT", kartSonDort: "****1234" })).toMatchObject({ odemeSekli: "nakit", kartSonDort: "1234" });
  });

  it("anlaşılamayan değer boş kalır, ayrıştırma başarılı olur", () => {
    const v = fisFaturaOcrSonucSemasi.parse({ ...temel, plaka: { x: 1 }, litre: -5, odemeSekli: 3, kartSonDort: "**" });
    expect(v).toMatchObject({ plaka: null, litre: null, odemeSekli: null, kartSonDort: null });
    expect(fisFaturaOcrSonucSemasi.parse({ ...temel, plaka: "X".repeat(40) }).plaka).toBeNull();
    expect(fisFaturaOcrSonucSemasi.parse(temel).plaka ?? null).toBeNull();
  });
});
