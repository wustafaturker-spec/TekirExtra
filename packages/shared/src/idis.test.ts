import { describe, expect, it } from "vitest";
import { etiketNoGecerliMi, idisBelgesiMi, idisEngelleri, sevkiyatNoGecerliMi } from "./idis";

describe("İDİS biçim kuralları", () => {
  it("sevkiyat numarası SE- ya da ES- ile başlar, 7 rakamla sürer", () => {
    expect(sevkiyatNoGecerliMi("SE-1345840")).toBe(true);
    expect(sevkiyatNoGecerliMi("ES-1234567")).toBe(true); // 14.09.2026 şematronu
    expect(sevkiyatNoGecerliMi("se-1234567")).toBe(true); // büyütülür
    expect(sevkiyatNoGecerliMi("SE-12345")).toBe(false);
    expect(sevkiyatNoGecerliMi("XX-1234567")).toBe(false);
  });

  it("etiket numarası 2 harf + 7 rakamdır", () => {
    expect(etiketNoGecerliMi("CV0152457")).toBe(true);
    expect(etiketNoGecerliMi("C10152457")).toBe(false);
    expect(etiketNoGecerliMi("CV015245")).toBe(false);
  });

  it("belge, sevkiyat numarası girildiğinde İDİS kapsamındadır", () => {
    expect(idisBelgesiMi("SE-1345840")).toBe(true);
    expect(idisBelgesiMi(" ")).toBe(false);
    expect(idisBelgesiMi(null)).toBe(false);
  });
});

describe("idisEngelleri", () => {
  it("İDİS dışı belgede kural işlemez", () => {
    expect(idisEngelleri({ satirlar: [{ sira: 1 }] })).toEqual([]);
  });

  it("her satırda etiket numarası ister", () => {
    const engeller = idisEngelleri({ sevkiyatNo: "SE-1345840", satirlar: [{ sira: 1, etiketNo: "CV0152457" }, { sira: 2 }] });
    expect(engeller).toEqual([{ alan: "etiketNo", mesaj: "2. satırda İDİS etiket numarası girilmelidir" }]);
  });

  it("bozuk sevkiyat ve etiket numarasını reddeder", () => {
    const engeller = idisEngelleri({ sevkiyatNo: "SE-123", satirlar: [{ sira: 1, etiketNo: "XX-123" }] });
    expect(engeller.map((e) => e.alan)).toEqual(["sevkiyatNo", "etiketNo"]);
  });

  it("eksiksiz belgede engel yok", () => {
    expect(idisEngelleri({ sevkiyatNo: "SE-1345840", satirlar: [{ sira: 1, etiketNo: "CV0152457" }] })).toEqual([]);
  });
});
