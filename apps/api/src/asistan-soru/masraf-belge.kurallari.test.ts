import { describe, expect, it } from "vitest";
import { kategoriAdlaBul, kategoriSorusu, masrafTaslagi } from "./masraf-belge.kurallari";

const ocr = (ek: Record<string, unknown> = {}) => ({
  belgeTuru: "FIS", belgeNo: "F-12", tarih: "2026-11-10", saticiUnvan: "Shell Petrol A.Ş.", saticiVknTckn: "1234567890", paraBirimi: "TRY",
  toplamKdv: 200, toplamMatrah: 1000, genelToplam: 1200, kdvKirilimi: [{ oran: 20, matrah: 1000, kdvTutari: 200 }],
  kalemler: [{ aciklama: "Benzin", miktar: 30, birim: "LT", birimFiyat: 40, toplamTutar: 1200 }], guvenSkoru: 0.95, ...ek,
}) as never;

describe("OCR'dan masraf taslağı (CNL-16)", () => {
  it("alanlar OCR'dan; açıklama kullanıcının notu ve kalemlerden", () => {
    const { taslak, uyarilar } = masrafTaslagi(ocr(), "cari-1", "Ankara yolu");
    expect(taslak).toEqual({ belgeTuru: "fis", tarih: "2026-11-10", belgeNo: "F-12", saticiUnvan: "Shell Petrol A.Ş.", vknTckn: "1234567890", cariId: "cari-1", aciklama: "Ankara yolu — Benzin", toplam: 1200, kdvOrani: 20, dovizCinsi: "TRY" });
    expect(uyarilar).toEqual([]);
  });

  it("birden çok KDV oranı, eksik tarih ve düşük güven uyarı olur; oran uydurulmaz", () => {
    const { taslak, uyarilar } = masrafTaslagi(ocr({ tarih: null, guvenSkoru: 0.4, belgeTuru: "E_ARSIV", kdvKirilimi: [{ oran: 10, matrah: 300, kdvTutari: 30 }, { oran: 20, matrah: 700, kdvTutari: 140 }] }), null, null);
    expect(taslak.kdvOrani).toBe(20);
    expect(taslak.belgeTuru).toBe("fatura");
    expect(taslak.tarih).toBeUndefined();
    expect(uyarilar.join(" ")).toMatch(/birden çok KDV oranı.*%20, %10/);
    expect(uyarilar.join(" ")).toMatch(/tarihi okunamadı/);
    expect(uyarilar.join(" ")).toMatch(/güveni düşük/);
  });

  it("kategori adı yalnız tek eşleşmede seçilir", () => {
    const k = [{ id: "a", ad: "Akaryakıt" }, { id: "b", ad: "Yemek ve Temsil" }, { id: "c", ad: "Temsil Ağırlama" }];
    expect(kategoriAdlaBul("akaryakıt", k)).toBe("a");
    expect(kategoriAdlaBul("temsil", k)).toBeNull();
    expect(kategoriAdlaBul("", k)).toBeNull();
    expect(kategoriAdlaBul("kırtasiye", k)).toBeNull();
    // 2026-11-12 gerçek fiş: OCR "Akaryakıt / Ulaşım", kategori "Akaryakıt ve Ulaşım".
    expect(kategoriAdlaBul("Akaryakıt / Ulaşım", [{ id: "x", ad: "Akaryakıt ve Ulaşım" }, { id: "y", ad: "Kırtasiye" }])).toBe("x");
    expect(kategoriAdlaBul("Akaryakıt / Ulaşım", [{ id: "x", ad: "Akaryakıt" }, { id: "y", ad: "Ulaşım" }])).toBeNull();
    expect(kategoriAdlaBul("Yemek / Temsil Ağırlama", [{ id: "x", ad: "Temsil ve Ağırlama Giderleri" }])).toBe("x");
  });

  it("kategori sorusu en çok beş kategori ve panel seçeneği sunar", () => {
    const s = kategoriSorusu(masrafTaslagi(ocr(), null, null).taslak, Array.from({ length: 7 }, (_, i) => ({ id: String(i), ad: `K${i}` })));
    expect(s.secenekler.map((x) => x.kod)).toEqual(["kat0", "kat1", "kat2", "kat3", "kat4", "panel"]);
    expect(s.soru).toContain("Shell Petrol A.Ş. — 1.200,00 TL, 10.11.2026");
  });
});
