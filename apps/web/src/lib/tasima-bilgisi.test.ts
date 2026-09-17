import { describe, expect, it } from "vitest";
import { eksikTasiyanAlanlari, tasiyanBelli } from "./tasima-bilgisi";

const bos = { tasiyiciCariId: null, soforAdi: null, soforSoyadi: null, plaka: null };

describe("tasiyanBelli", () => {
  it("taşıyıcı cari seçiliyse şoför bilgisi aranmaz", () => {
    expect(tasiyanBelli({ ...bos, tasiyiciCariId: "c1" })).toBe(true);
    expect(eksikTasiyanAlanlari({ ...bos, tasiyiciCariId: "c1" })).toEqual([]);
  });

  it("kendi aracımızla giderken üç alan da istenir", () => {
    expect(tasiyanBelli({ ...bos, soforAdi: "Ali", soforSoyadi: "Veli", plaka: "34 ABC 123" })).toBe(true);
    expect(tasiyanBelli({ ...bos, soforAdi: "Ali", plaka: "34 ABC 123" })).toBe(false);
  });

  it("eksik alanları adıyla söyler", () => {
    expect(eksikTasiyanAlanlari({ ...bos, soforAdi: "Ali" })).toEqual(["şoför soyadı", "plaka"]);
    expect(eksikTasiyanAlanlari(bos)).toEqual(["şoför adı", "şoför soyadı", "plaka"]);
  });

  it("yalnız boşluk girilen alan dolu sayılmaz", () => {
    expect(tasiyanBelli({ tasiyiciCariId: "  ", soforAdi: "Ali", soforSoyadi: "Veli", plaka: "   " })).toBe(false);
  });
});
