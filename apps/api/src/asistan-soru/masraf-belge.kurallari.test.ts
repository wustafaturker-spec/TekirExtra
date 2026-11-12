import { describe, expect, it } from "vitest";
import { kategoriAdlaBul, kategoriSorusu, masrafTaslagi, odemeSorusu, tamamlamaPlani } from "./masraf-belge.kurallari";

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

describe("fişten ödeme hesabı ve araç (CNL-21/22)", () => {
  const b = { cariBagli: false, dovizCinsi: "TRY", kategoriAdi: "Akaryakıt ve Ulaşım" };
  const kartlar = [
    { id: "k1", ad: "İş Bankası", sonDortHane: "1234", dovizCinsi: "TRY", aktif: true },
    { id: "k2", ad: "Garanti", sonDortHane: "9876", dovizCinsi: "TRY", aktif: true },
    { id: "k3", ad: "Eski", sonDortHane: "5555", dovizCinsi: "TRY", aktif: false },
  ];
  const kasalar = [{ id: "ks1", ad: "Merkez Kasa", dovizCinsi: "TRY", aktif: true }, { id: "ks2", ad: "USD Kasa", dovizCinsi: "USD", aktif: true }];
  const araclar = [{ id: "a1", plaka: "34 ABC 123", aktif: true }];

  it("plaka boşluk/harf farkıyla eşleşir; litre akaryakıta yazılır; kart son dört hanesiyle bulunur", () => {
    const p = tamamlamaPlani({ plaka: "34abc123", litre: 41.234, odemeSekli: "kart", kartSonDort: "9876" }, b, kartlar, kasalar, araclar);
    expect(p).toEqual({ notlar: [], arac: { aracId: "a1", plaka: "34 ABC 123", kategori: "akaryakit", litre: 41.23 }, odeme: { tur: "kart", hesapId: "k2", ad: "Garanti •••• 9876" } });
  });

  it("eşleşmeyen kart → aktif kartlarla soru; pasif kart seçenek değil", () => {
    const p = tamamlamaPlani({ odemeSekli: "kart", kartSonDort: "5555" }, b, kartlar, kasalar, araclar);
    expect(p.odeme).toBeUndefined();
    expect(p.soru).toEqual({ tur: "kart", hesaplar: [{ id: "k1", ad: "İş Bankası •••• 1234" }, { id: "k2", ad: "Garanti •••• 9876" }] });
    const s = odemeSorusu(masrafTaslagi(ocr(), null, null).taslak, p.soru!, "5555");
    expect(s.soru).toContain("•••• 5555");
    expect(s.secenekler.map((x) => x.kod)).toEqual(["h0", "h1", "sirket_degil", "panel"]);
  });

  it("nakit: tek kasa (aynı döviz) doğrudan; çok kasa soru; plaka yoksa not", () => {
    expect(tamamlamaPlani({ odemeSekli: "nakit", plaka: "06 X 1" }, b, kartlar, kasalar, araclar)).toEqual({
      notlar: ["Fişteki 06X1 plakası araç kartlarında yok; araca bağlanmadı."], odeme: { tur: "kasa", hesapId: "ks1", ad: "Merkez Kasa" },
    });
    const iki = [...kasalar, { id: "ks3", ad: "Şube Kasa", dovizCinsi: "TRY", aktif: true }];
    expect(tamamlamaPlani({ odemeSekli: "nakit" }, b, kartlar, iki, araclar).soru?.tur).toBe("kasa");
  });

  it("cari bağlıysa ödeme önerilmez; ödeme şekli okunamadıysa not", () => {
    expect(tamamlamaPlani({ odemeSekli: "kart", kartSonDort: "1234" }, { ...b, cariBagli: true }, kartlar, kasalar, araclar)).toEqual({ notlar: ["Satıcı cari olarak kayıtlı; ödeme cari tediyesinden yapılır."] });
    expect(tamamlamaPlani({ odemeSekli: "bilinmiyor" }, b, kartlar, kasalar, araclar).notlar).toEqual(["Ödeme şekli fişten okunamadı; ödemeyi panelde seçin."]);
  });

  it("litresiz otopark fişi otopark kategorisine düşer", () => {
    expect(tamamlamaPlani({ plaka: "34 ABC 123" }, { ...b, kategoriAdi: "Otopark" }, [], [], araclar).arac?.kategori).toBe("otopark");
  });
});
