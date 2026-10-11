import { describe, expect, it } from "vitest";
import { karsilastir, karsilastirmaDonemi, toplamKarsilastirmaMetni } from "./rapor-karsilastirma";
import type { RaporKolon } from "./rapor-kayit";

describe("karşılaştırma dönemi (RPR-25)", () => {
  it("önceki dönem: kısmi aralık aynı uzunlukta hemen öncesi, tam ay önceki tam ay", () => {
    expect(karsilastirmaDonemi("2026-10-01", "2026-10-11", { tur: "onceki" })).toEqual({ baslangic: "2026-09-20", bitis: "2026-09-30" });
    expect(karsilastirmaDonemi("2026-03-01", "2026-03-31", { tur: "onceki" })).toEqual({ baslangic: "2026-02-01", bitis: "2026-02-28" });
    expect(karsilastirmaDonemi("2026-01-01", "2026-03-31", { tur: "onceki" })).toEqual({ baslangic: "2025-10-01", bitis: "2025-12-31" });
  });

  it("geçen yıl: bir yıl geri, 29 Şubat 28 Şubat'a düşer", () => {
    expect(karsilastirmaDonemi("2026-10-01", "2026-10-11", { tur: "gecen_yil" })).toEqual({ baslangic: "2025-10-01", bitis: "2025-10-11" });
    expect(karsilastirmaDonemi("2028-02-01", "2028-02-29", { tur: "gecen_yil" })).toEqual({ baslangic: "2027-02-01", bitis: "2027-02-28" });
  });

  it("elle dönem doğrulanır", () => {
    expect(karsilastirmaDonemi("2026-10-01", "2026-10-11", { tur: "elle", baslangic: "2025-01-01", bitis: "2025-01-31" })).toEqual({ baslangic: "2025-01-01", bitis: "2025-01-31" });
    expect(karsilastirmaDonemi("2026-10-01", "2026-10-11", { tur: "elle", baslangic: "2025-02-01", bitis: "2025-01-31" })).toBeNull();
  });
});

const kolonlar: RaporKolon[] = [
  { alan: "cari", baslik: "Cari", tip: "metin" },
  { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
  { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
  { alan: "marj", baslik: "Marj", tip: "yuzde" },
];

describe("karşılaştırma (RPR-25)", () => {
  it("zaman dışı kırılımda satırlar eşleşir; yalnız bir dönemde olan satır 0 ile gelir", () => {
    const r = karsilastir(kolonlar,
      [{ cari: "A", dovizCinsi: "TRY", tutar: 120, marj: 10 }, { cari: "B", dovizCinsi: "TRY", tutar: 50, marj: 5 }],
      [{ cari: "A", dovizCinsi: "TRY", tutar: 100, marj: 8 }, { cari: "C", dovizCinsi: "TRY", tutar: 30, marj: 3 }]);
    expect(r.satirKarsilastirmasi).toBe(true);
    expect(r.kolonlar.map((k) => k.alan)).toEqual(["cari", "dovizCinsi", "tutar", "tutar__onceki", "tutar__degisim", "marj"]);
    expect(r.satirlar).toEqual([
      { cari: "A", dovizCinsi: "TRY", tutar: 120, marj: 10, tutar__onceki: 100, tutar__degisim: 20 },
      { cari: "B", dovizCinsi: "TRY", tutar: 50, marj: 5, tutar__onceki: 0, tutar__degisim: null },
      { cari: "C", dovizCinsi: "TRY", tutar: 0, marj: null, tutar__onceki: 30, tutar__degisim: -100 },
    ]);
    expect(r.toplamlar).toEqual([{ alan: "tutar", baslik: "Tutar", tip: "para", doviz: "TRY", bu: 170, onceki: 130, fark: 40, yuzde: 30.77 }]);
  });

  it("zaman kırılımında (2026-10 gibi anahtar) yalnız toplamlar karşılaştırılır", () => {
    const r = karsilastir([{ alan: "grup", baslik: "Ay", tip: "metin" }, { alan: "tutar", baslik: "Tutar", tip: "para", toplam: true }],
      [{ grup: "2026-10", tutar: 10 }], [{ grup: "2025-10", tutar: 5 }]);
    expect(r.satirKarsilastirmasi).toBe(false);
    expect(r.satirlar).toEqual([{ grup: "2026-10", tutar: 10 }]);
    expect(r.toplamlar[0]).toMatchObject({ bu: 10, onceki: 5, yuzde: 100 });
  });

  it("karışık dövizli sütun toplam karşılaştırmasına girmez; metin biçimi", () => {
    const r = karsilastir(kolonlar, [{ cari: "A", dovizCinsi: "USD", tutar: 1 }, { cari: "B", dovizCinsi: "EUR", tutar: 1 }], [{ cari: "A", dovizCinsi: "USD", tutar: 1 }]);
    expect(r.toplamlar).toEqual([]);
    expect(toplamKarsilastirmaMetni([{ alan: "t", baslik: "Net satış", tip: "para", bu: 1200, onceki: 1000, fark: 200, yuzde: 20 }])).toEqual(["Net satış: 1.200,00 TL ← 1.000,00 TL (+20 %)"]);
  });
});
