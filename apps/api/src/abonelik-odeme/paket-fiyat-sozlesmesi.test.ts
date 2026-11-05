import { describe, expect, it } from "vitest";
import { abonelikTutari } from "./abonelik-tutari";
import { ABONELIK_SURELERI, paketFiyatiHesapla, type PaketFiyatSozlesmesi } from "./paket-fiyat-sozlesmesi";

const fiyat = (matrah = "999.00"): PaketFiyatSozlesmesi => ({
  paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20",
  donemler: [{ aySayisi: 1, matrah }, { aySayisi: 12, matrah: "9990.00" }],
});

describe("Paket fiyat sözleşmesi", () => {
  it("yıllık bedeli sözleşmeden alır; aylık fiyatı çarparak indirim bilgisini kaybetmez", () => {
    const sonuc = paketFiyatiHesapla(fiyat(), 12);
    expect(sonuc.matrah.toFixed(2)).toBe("9990.00");
    expect(sonuc.kdv.toFixed(2)).toBe("1998.00");
    expect(sonuc.toplam.toFixed(2)).toBe("11988.00");
  });
  it("yarım kuruş vergiyi yukarı yuvarlar ve toplamı yuvarlanmış vergiden üretir", () => {
    const sonuc = paketFiyatiHesapla({ ...fiyat("0.05"), kdvOrani: "10" }, 1);
    expect(sonuc.kdv.toFixed(2)).toBe("0.01");
    expect(sonuc.toplam.toFixed(2)).toBe("0.06");
  });
  it("sıfır tutarı ve sıfır vergiyi destekler", () => {
    expect(paketFiyatiHesapla(fiyat("0"), 1).toplam.toFixed(2)).toBe("0.00");
    expect(paketFiyatiHesapla({ ...fiyat(), kdvOrani: "0" }, 1).toplam.toFixed(2)).toBe("999.00");
  });
  it.each(["-1", "1.001", "1e3", "NaN", "Infinity", "1,50", " 1", "", "1000000000000"])("geçersiz tutarı reddeder: %s", (matrah) => {
    expect(() => paketFiyatiHesapla(fiyat(matrah), 1)).toThrow();
  });
  it.each(["-1", "100.01", "NaN", "20.001"])("geçersiz vergiyi reddeder: %s", (kdvOrani) => {
    expect(() => paketFiyatiHesapla({ ...fiyat(), kdvOrani }, 1)).toThrow();
  });
  it("desteklenmeyen para birimi ve vergi dahil bedeli reddeder", () => {
    expect(() => paketFiyatiHesapla({ ...fiyat(), paraBirimi: "USD" } as unknown as PaketFiyatSozlesmesi, 1)).toThrow();
    expect(() => paketFiyatiHesapla({ ...fiyat(), vergiDahil: true } as unknown as PaketFiyatSozlesmesi, 1)).toThrow();
  });
  it("eksik, desteklenmeyen ve tekrarlanan dönemleri reddeder", () => {
    expect(() => paketFiyatiHesapla(fiyat(), 3)).toThrow();
    expect(() => paketFiyatiHesapla({ ...fiyat(), donemler: [] }, 1)).toThrow();
    expect(() => paketFiyatiHesapla({ ...fiyat(), donemler: [{ aySayisi: 2, matrah: "1" }] } as unknown as PaketFiyatSozlesmesi, 1)).toThrow();
    expect(() => paketFiyatiHesapla({ ...fiyat(), donemler: [fiyat().donemler[0], fiyat().donemler[0]] }, 1)).toThrow();
  });
  it("seçilmeyen dönemdeki bozuk fiyatı da reddeder", () => {
    expect(() => paketFiyatiHesapla({ ...fiyat(), donemler: [...fiyat().donemler, { aySayisi: 3, matrah: "-1" }] }, 1)).toThrow();
  });
  it.each(ABONELIK_SURELERI)("eski planların %i aylık matrah, vergi ve toplamlarını korur", (ay) => {
    for (const [kod, aylik] of [["baslangic", 399], ["profesyonel", 999], ["v1", 999]] as const) {
      const tutar = abonelikTutari(kod, ay)!;
      expect(tutar.matrah.toFixed(2)).toBe((aylik * ay).toFixed(2));
      expect(tutar.kdv.toFixed(2)).toBe((aylik * ay * 0.2).toFixed(2));
      expect(tutar.toplam.toFixed(2)).toBe((aylik * ay * 1.2).toFixed(2));
    }
    expect(abonelikTutari("kurumsal", ay)).toBeNull();
    expect(abonelikTutari("bilinmeyen", ay)).toBeNull();
  });
});
