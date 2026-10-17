import { describe, expect, it } from "vitest";
import { odemeSozuListesiniDogrula, sozFaturalariniDogrula, sozGunuGecerli, sozParaBicimi, sozTutari } from "./odeme-sozu";
const cariId = "11111111-1111-4111-8111-111111111111", faturaId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const fixture = () => ({
  cari: { id: cariId, unvan: "Test" }, kullanimModu: "pilot", alindigiZaman: "2026-10-15T12:00:00Z", zamanHassasiyeti: "gun", uyari: "Aynı gün sırası bilinmiyor.",
  sozler: [{ id, cariId, faturaId, faturaNo: "SAT-01", dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: "2026-10-20", verildigiZaman: "2026-10-14T10:00:00Z", aciklama: "Telefon sözü", kayitDurumu: "aktif", sonlandirmaNedeni: null, surum: 1, oncekiSozId: null, gerceklesme: { sozId: id, durum: "kismen_gerceklesti", gerceklesen: "400.00", kalan: "600.00" } }],
});
describe("Ödeme sözü ekranı para ve kaynak sözleşmesi", () => {
  it.each([["1000,5", "1000.50"], ["1.25", "1.25"], ["0001", "1.00"], [" 42 ", "42.00"], ["9999999999999,99", "9999999999999.99"]])("%s tutarı kuruş kaybetmeden normalleşir", (girdi, sonuc) => {
    expect(sozTutari(girdi)).toBe(sonuc);
  });
  it.each(["0", "-1", "1e3", "1.000", "1.234,56", "1,234.56", "NaN", "", "10000000000000"])("belirsiz veya geçersiz tutar %s reddedilir", (v) => {
    expect(() => sozTutari(v)).toThrow();
  });
  it("büyük tutarda bir kuruş aşımı yakalanır", () => {
    expect(() => sozTutari("9999999999999.99", "9999999999999.98")).toThrow("aşamaz");
    expect(sozTutari("9999999999999.98", "9999999999999.99")).toBe("9999999999999.98");
    expect(sozParaBicimi("9999999999999.99", "USD")).toBe("9.999.999.999.999,99 USD");
  });
  it.each(["2026-02-30", "2026-13-01", "2026-10-01T12:00:00Z", "15.10.2026"])("geçersiz takvim günü %s reddedilir", (v) => expect(sozGunuGecerli(v)).toBe(false));
  it("artık yıl ve geçerli gün kabul edilir", () => { expect(sozGunuGecerli("2028-02-29")).toBe(true); });
  it("gerçek API biçimi kabul edilir", () => expect(odemeSozuListesiniDogrula(fixture(), cariId).sozler[0].gerceklesme.kalan).toBe("600.00"));
  it("farklı cari reddedilir", () => expect(() => odemeSozuListesiniDogrula(fixture(), faturaId)).toThrow());
  it.each([
    { tutar: "1000" }, { tutar: 1000 }, { dovizCinsi: null }, { surum: 0 }, { faturaId: "abc" }, { sozTarihi: "2026-02-30" },
    { gerceklesme: { sozId: id, durum: "gerceklesti", gerceklesen: "999.99", kalan: "0.00" } },
    { gerceklesme: { sozId: id, durum: "kismen_gerceklesti", gerceklesen: "0.00", kalan: "1000.00" } },
    { gerceklesme: { sozId: id, durum: "gerceklesti", gerceklesen: "400.00", kalan: "600.00" } },
  ])("tutarsız satır %j reddedilir", (fark) => {
    const v = fixture(); Object.assign(v.sozler[0], fark);
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
  });
  it("iptal/revizyon gerçekleşme olarak sunulmaz", () => {
    const v = fixture(); v.sozler[0].kayitDurumu = "revize";
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
    v.sozler[0].gerceklesme = { sozId: id, durum: "revize", gerceklesen: "0.00", kalan: "1000.00" };
    expect(odemeSozuListesiniDogrula(v, cariId).sozler[0].kayitDurumu).toBe("revize");
  });
  it("yinelenen söz ve aynı faturada iki aktif kayıt reddedilir", () => {
    const v = fixture(); v.sozler.push(structuredClone(v.sozler[0]));
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
    v.sozler[1].id = faturaId; v.sozler[1].gerceklesme.sozId = faturaId;
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
  });
  it("kapalı mod başarılı liste olarak kabul edilmez", () => {
    const v = fixture(); v.kullanimModu = "kapali";
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
  });
  it("bin söz sınırı ve bozuk yanıt reddedilir", () => {
    const v = fixture(); v.sozler = Array(1001).fill(v.sozler[0]);
    expect(() => odemeSozuListesiniDogrula(v, cariId)).toThrow();
    expect(() => odemeSozuListesiniDogrula([], cariId)).toThrow();
  });
  it("fatura sayfasında yalnız kalan pozitif kayıt seçilebilir", () => {
    const f = { id: faturaId, cari: { id: cariId }, no: "SAT-1", tip: "satis", durum: "kesin", dovizCinsi: "USD", odemeOzeti: { kalan: "0.00" } };
    expect(sozFaturalariniDogrula({ kayitlar: [f], sonrakiImlec: null }, cariId).faturalar).toEqual([]);
    f.odemeOzeti.kalan = "1.01";
    expect(sozFaturalariniDogrula({ kayitlar: [f], sonrakiImlec: null }, cariId).faturalar[0].kalan).toBe("1.01");
    f.cari.id = id;
    expect(() => sozFaturalariniDogrula({ kayitlar: [f], sonrakiImlec: null }, cariId)).toThrow();
  });
});
