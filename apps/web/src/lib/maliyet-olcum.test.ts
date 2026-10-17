import { describe, expect, it } from "vitest";
import { maliyetOlcumDosyasiniOku, maliyetOlcumleriniKarsilastir, maliyetOlcumunuDogrula, olcumSayiBicimi, type MaliyetOlcumu } from "./maliyet-olcum";

function olcum(): MaliyetOlcumu { return {
  surum: 1, olcumTuru: "anlik", firma: { id: "a1111111-1111-4111-8111-111111111111", unvan: "Test firma" }, baslangic: "2026-10-01", bitis: "2026-10-15", kullanimModu: "pilot", alindigiZaman: "2026-10-15T09:00:00.000Z",
  kapsam: { malSatisSatiri: 10, takipliKaynakSatiri: 4, kaynakKimlikOzeti: "a".repeat(64) }, uyari: { satir: 2, ciro: "140.10", aktifTakipliSatir: 1, aktifTakipsizSatir: 1 },
  incelemeler: { toplam: 5, acik: 1, incelemede: 0, beklemede: 1, dogrulanmisKapanis: 2, digerKapanis: 1, yoksayildi: 0, medyanSureSaniye: "3600.000", sureOrnekSayisi: 2, sureDisiKayit: 0 },
}; }
function sonraki() { const v = olcum(); v.alindigiZaman = "2026-10-15T10:00:00.000Z"; return v; }
describe("ölçüm dosyası sözleşmesi", () => {
  it("indirilen biçimi ve UTF-8 BOM'lu dosyayı kabul eder", () => {
    const v = olcum(); expect(maliyetOlcumDosyasiniOku(`\uFEFF${JSON.stringify(v)}`)).toEqual(v);
  });
  it.each([
    ["sürüm", (v: any) => { v.surum = 2; }], ["ölçüm türü", (v: any) => { v.olcumTuru = "baz"; }],
    ["şirket", (v: any) => { v.firma.id = "t1"; }], ["mod", (v: any) => { v.kullanimModu = "kapali"; }],
    ["tarih", (v: any) => { v.baslangic = "2026-02-30"; }], ["ters dönem", (v: any) => { v.bitis = "2026-09-01"; }],
    ["uzun dönem", (v: any) => { v.baslangic = "2024-01-01"; }], ["zaman", (v: any) => { v.alindigiZaman = "bozuk"; }],
    ["eksik kaynak özeti", (v: any) => { delete v.kapsam.kaynakKimlikOzeti; }], ["bozuk özet", (v: any) => { v.kapsam.kaynakKimlikOzeti = "x".repeat(64); }],
    ["ek alan", (v: any) => { v.not = "beklenmeyen"; }], ["dizi", (v: any) => { v.incelemeler = []; }],
    ["negatif sayı", (v: any) => { v.uyari.satir = -1; }], ["üst sınır", (v: any) => { v.kapsam.malSatisSatiri = 20001; }],
    ["satır toplamı", (v: any) => { v.uyari.aktifTakipsizSatir = 2; }], ["kapsam toplamı", (v: any) => { v.kapsam.malSatisSatiri = 1; }],
    ["kayıt toplamı", (v: any) => { v.incelemeler.toplam = 6; }], ["süre örneği", (v: any) => { v.incelemeler.sureOrnekSayisi = 3; }],
    ["eksik medyan", (v: any) => { v.incelemeler.medyanSureSaniye = null; }], ["negatif medyan", (v: any) => { v.incelemeler.medyanSureSaniye = "-1.000"; }],
    ["sayısal ciro", (v: any) => { v.uyari.ciro = 140.1; }], ["bilimsel gösterim", (v: any) => { v.uyari.ciro = "1e3"; }],
    ["kuruş biçimi", (v: any) => { v.uyari.ciro = "140.1"; }], ["uyarıya aykırı ciro", (v: any) => { v.uyari.ciro = "0.00"; }],
  ])("geçersiz %s kabul edilmez", (_ad, degistir) => {
    const v = olcum(); (degistir as (v: any) => void)(v); expect(() => maliyetOlcumunuDogrula(v)).toThrow("Ölçüm biçimi geçersiz");
  });
  it("geçersiz JSON ve 64 KB üzerindeki UTF-8 içeriği reddeder", () => {
    expect(() => maliyetOlcumDosyasiniOku("{" )).toThrow("JSON");
    expect(() => maliyetOlcumDosyasiniOku("ğ".repeat(40000))).toThrow("64 KB");
    expect(() => maliyetOlcumDosyasiniOku('null')).toThrow("Ölçüm biçimi");
  });
  it("prototip anahtarı olan JSON'u reddeder", () => {
    expect(() => maliyetOlcumDosyasiniOku(JSON.stringify(olcum()).replace('"surum":1', '"__proto__":{"polluted":true},"surum":1'))).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
describe("aynı kapsamın karşılaştırması", () => {
  it("satır, ciro ve süre farklarını hesaplar; mod değişimini belirtir", () => {
    const current = sonraki(); current.kullanimModu = "acik"; current.uyari = { satir: 1, ciro: "100.09", aktifTakipliSatir: 1, aktifTakipsizSatir: 0 };
    current.incelemeler = { ...current.incelemeler, toplam: 6, dogrulanmisKapanis: 3, sureOrnekSayisi: 3, medyanSureSaniye: "1800.000" };
    const r = maliyetOlcumleriniKarsilastir(olcum(), current); expect(r.modDegisti).toBe(true);
    expect(r.satirlar[0].fark).toBe("-1"); expect(r.satirlar[1].fark).toBe("-40.01");
    expect(r.satirlar.find((s) => s.ad === "Medyan süre (saniye)")?.fark).toBe("-1800.000");
  });
  it.each([
    ["şirket", (v: MaliyetOlcumu) => { v.firma.id = "b1111111-1111-4111-8111-111111111111"; }, "farklı şirket"],
    ["dönem", (v: MaliyetOlcumu) => { v.baslangic = "2026-10-02"; }, "dönemleri farklı"],
    ["kaynak kimliği", (v: MaliyetOlcumu) => { v.kapsam.kaynakKimlikOzeti = "b".repeat(64); }, "kapsamı değişmiş"],
    ["kaynak sayısı", (v: MaliyetOlcumu) => { v.kapsam.malSatisSatiri = 11; }, "kapsamı değişmiş"],
    ["aynı zaman", (v: MaliyetOlcumu) => { v.alindigiZaman = olcum().alindigiZaman; }, "eski olmalı"],
    ["ters zaman", (v: MaliyetOlcumu) => { v.alindigiZaman = "2026-10-15T08:00:00.000Z"; }, "eski olmalı"],
  ])("uyumsuz %s için fark üretmez", (_ad, degistir, mesaj) => {
    const v = sonraki(); (degistir as (v: MaliyetOlcumu) => void)(v); expect(() => maliyetOlcumleriniKarsilastir(olcum(), v)).toThrow(mesaj as string);
  });
  it("büyük tutarda bir kuruşu kaybetmez ve taşımayı tam yapar", () => {
    const base = olcum(), current = sonraki(); base.uyari.ciro = "9007199254740993.12"; current.uyari.ciro = "9007199254740993.13";
    expect(maliyetOlcumleriniKarsilastir(base, current).satirlar[1].fark).toBe("0.01");
    base.uyari.ciro = "99999999999999999999999999999.99"; current.uyari.ciro = "100000000000000000000000000000.00";
    expect(maliyetOlcumleriniKarsilastir(base, current).satirlar[1].fark).toBe("0.01");
  });
  it("örnek olmayan medyanı sıfır saymaz", () => {
    const base = olcum(); base.incelemeler.sureDisiKayit = 2; base.incelemeler.sureOrnekSayisi = 0; base.incelemeler.medyanSureSaniye = null;
    const row = maliyetOlcumleriniKarsilastir(base, sonraki()).satirlar.find((s) => s.ad === "Medyan süre (saniye)")!;
    expect(row).toMatchObject({ baz: null, guncel: "3600.000", fark: null });
  });
  it("şirket adı değişse veya UUID büyük harfle yazılsa da kimliği aynı kalır", () => {
    const base = olcum(); base.firma.id = base.firma.id.toUpperCase(); base.firma.unvan = "Eski ad";
    expect(maliyetOlcumleriniKarsilastir(base, sonraki()).satirlar[0].fark).toBe("0");
  });
  it("biçimlerken büyük sayıyı Number'a dönüştürmez", () => {
    expect(olcumSayiBicimi("-40.01")).toBe("-40,01");
    expect(olcumSayiBicimi("9007199254740993.13")).toBe("9.007.199.254.740.993,13");
  });
});
