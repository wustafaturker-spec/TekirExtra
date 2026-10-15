import { describe, expect, it } from "vitest";
import { finansKaynaklariCikar } from "./finans-kaynaklari";

describe("kaynaklı finans verileri", () => {
  it.each(["30000.00", "0.00", "-1250.50", "9999999999999999.99"])("diğer gelirleri kaynaktaki işaret ve hassasiyetle korur: %s", digerGelirler => {
    const [k] = finansKaynaklariCikar("gelir_gider", JSON.stringify({
      adres: "/panel/raporlar/gelir-gider?baslangic=2026-10-01&bitis=2026-10-14",
      karZarar: { brutKar: "439316.32", digerGelirler, faaliyetGiderleri: "49015.78", netKar: "420300.54" },
      uyarilar: ["Maliyet kaydı eksik"],
    }));
    expect(k.kalemler).toEqual([
      { ad: "Brüt kâr", deger: "439316.32", paraBirimi: "TRY" },
      { ad: "Diğer gelirler", deger: digerGelirler, paraBirimi: "TRY" },
      { ad: "Faaliyet giderleri", deger: "49015.78", paraBirimi: "TRY" },
      { ad: "Net kâr", deger: "420300.54", paraBirimi: "TRY" },
    ]);
    expect(k.uyarilar).toContain("Maliyet kaydı eksik");
  });
  it("kaynakta olmayan diğer geliri net kâr farkından uydurmaz", () => {
    const [k] = finansKaynaklariCikar("gelir_gider", JSON.stringify({
      adres: "/panel/raporlar/gelir-gider", karZarar: { brutKar: "439316.32", faaliyetGiderleri: "49015.78", netKar: "420300.54" },
    }));
    expect(k.kalemler.some(v => v.ad === "Diğer gelirler")).toBe(false);
  });
  it("hassasiyeti kaybolabilecek büyük number'ı göstermeyip decimal-string'i korur", () => {
    const [k] = finansKaynaklariCikar("finansal_ozet", JSON.stringify({ nakitVarliklar: 9999999999999999, toplamBorclar: "9999999999999999.99", toplamAlacaklar: "-12.34" }));
    expect(k.kalemler).toEqual([{ ad: "Alacaklar", deger: "-12.34", paraBirimi: "TRY" }, { ad: "Borçlar", deger: "9999999999999999.99", paraBirimi: "TRY" }]);
    expect(k.uyarilar).toEqual([expect.stringContaining("decimal-string")]);
    const [bos] = finansKaynaklariCikar("finansal_ozet", '{"nakitVarliklar":9999999999999999}');
    expect(bos.kalemler).toEqual([]);
    expect(bos.uyarilar).toHaveLength(1);
  });
  it("bir cari için hassasiyet uyarısı diğer kayda taşınmaz", () => {
    const kaynaklar = finansKaynaklariCikar("cari_ara", JSON.stringify({ kayitlar: [
      { id: "11111111-1111-4111-8111-111111111111", bakiyeler: [{ dovizCinsi: "USD", bakiye: 9999999999999999 }] },
      { id: "22222222-2222-4222-8222-222222222222", bakiyeler: [{ dovizCinsi: "TRY", bakiye: -0.01 }] },
    ] }));
    expect(kaynaklar[0].kalemler).toEqual([]);
    expect(kaynaklar[0].uyarilar).toHaveLength(1);
    expect(kaynaklar[1].uyarilar).toEqual([]);
    expect(kaynaklar[1].kalemler[0].deger).toBe("-0.01");
  });
  it("boş kur eksikliği listesi için uyarı üretmez", () => {
    expect(finansKaynaklariCikar("finansal_ozet", '{"nakitVarliklar":"0.00","kurEksik":[]}')[0].uyarilar).toEqual([]);
    expect(finansKaynaklariCikar("finansal_ozet", '{"nakitVarliklar":"0.00","kurEksik":["USD"]}')[0].uyarilar).toHaveLength(1);
  });
  it("negatif/çok büyük tutarı yeniden hesaplamaz ve cari dövizlerini ayrı tutar", () => {
    const veri = { id: "11111111-1111-4111-8111-111111111111", unvan: "Test", adres: "https://evil.example", bakiyeler: [{ dovizCinsi: "TRY", bakiye: "-1250.50" }, { dovizCinsi: "USD", bakiye: "9999999999999999.99" }, { bakiye: "15.00" }] };
    const [k] = finansKaynaklariCikar("cari_getir", JSON.stringify(veri));
    expect(k.adres).toBe(`/panel/cari/${veri.id}`);
    expect(k.kalemler).toEqual([{ ad: "Bakiye", deger: "-1250.50", paraBirimi: "TRY" }, { ad: "Bakiye", deger: "9999999999999999.99", paraBirimi: "USD" }]);
  });
  it("rapor toplamındaki karışık döviz ve kesilmiş satırları belirtir; bilinmeyen dövizi uydurmaz", () => {
    const [k] = finansKaynaklariCikar("rapor_calistir", JSON.stringify({
      ad: "Test raporu", adres: "/panel/raporlar?rapor=test&f.baslangic=2026-10-01&f.bitis=2026-10-14", satirSayisi: 42, satirlar: [{}],
      kolonlar: [{ alan: "a", tip: "para", baslik: "Döviz toplamı", dovizAlani: "dovizCinsi" }, { alan: "b", tip: "para", baslik: "TL" }, { alan: "c", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "d", tip: "para", dovizAlani: "dovizCinsi" }],
      toplamlar: { a: "karisik", b: { deger: 0 }, c: { deger: 15, doviz: "EUR" }, d: { deger: 50 } },
    }));
    expect(k.kalemler).toEqual([{ ad: "TL", deger: "0", paraBirimi: "TRY" }, { ad: "c", deger: "15", paraBirimi: "EUR" }]);
    expect(k.uyarilar).toEqual(expect.arrayContaining([expect.stringContaining("farklı para"), expect.stringContaining("1 / 42")]));
    expect(k.donem).toMatchObject({ baslangic: "2026-10-01", bitis: "2026-10-14" });
  });
  it("harici içerik, bilinmeyen araç, sahte kimlik ve uygunsuz rapor yolu kaynak olamaz", () => {
    for (const arac of ["gelen_eposta_getir", "ocr", "uydurma", "belge_taslagi_olustur"]) expect(finansKaynaklariCikar(arac, '{"toplamAlacakTry":"100.00"}')).toEqual([]);
    expect(finansKaynaklariCikar("cari_getir", '{"id":"yanlis","bakiyeler":[]}')).toEqual([]);
    for (const adres of ["https://evil.example/panel/raporlar", "/panel/raporlar/../../eposta", "/panel/raporlar-uydurma"]) expect(finansKaynaklariCikar("rapor_calistir", JSON.stringify({ adres }))).toEqual([]);
    expect(finansKaynaklariCikar("gelir_gider", "bozuk JSON")).toEqual([]);
  });
  it("tek satırlı raporda toplam satırı yoksa tutarı satırın kendi döviziyle gösterir", () => {
    const [k] = finansKaynaklariCikar("rapor_calistir", JSON.stringify({ adres: "/panel/raporlar?rapor=test", satirSayisi: 1, satirlar: [{ tutar: "12.34", doviz: "USD" }], toplamlar: null, kolonlar: [{ alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "doviz" }] }));
    expect(k.kalemler).toEqual([{ ad: "Tutar (tek satır)", deger: "12.34", paraBirimi: "USD" }]);
  });
  it("dönemi olmayan belgede tarih uydurmaz; gelir-giderde gerçek dönemi ve uyarıyı saklar", () => {
    const [belge] = finansKaynaklariCikar("fatura_getir", JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", genelToplam: "12.00", dovizCinsi: "EUR" }));
    expect(belge.donem.bitis).toBeUndefined();
    const [k] = finansKaynaklariCikar("gelir_gider", JSON.stringify({ adres: "/panel/raporlar/gelir-gider?baslangic=2026-10-01&bitis=2026-10-14", donem: { baslangic: "2026-10-01", bitis: "2026-10-14" }, karZarar: { netKar: "-15.00" }, uyarilar: ["Maliyet kaydı eksik"] }));
    expect(k.kalemler).toEqual([{ ad: "Net kâr", deger: "-15.00", paraBirimi: "TRY" }]);
    expect(k.uyarilar).toEqual(["Maliyet kaydı eksik"]);
  });
});
