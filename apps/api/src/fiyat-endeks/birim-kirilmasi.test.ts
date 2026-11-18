import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { fiyatSerisiHesapla } from "./fiyat-endeks-hesap";
import { ayniBirimDonemi } from "./birim-kirilmasi";
import { rolErisimi, FIYAT_ENDEKS_VARSAYILAN } from "./fiyat-endeks-erisim";

const D = (n: number) => new Prisma.Decimal(n);
const aylar = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"];
const fiyatlar = new Map(aylar.map((a, i) => [a, { tutar: D((i + 1) * 100), miktar: D(2), satir: 2 }]));
const endeksler = new Map([["TUFE", new Map(aylar.map((a) => [a, D(100)]))]]);

describe("birim kırılması", () => {
  it("kırılma ayını, baz ölçeğini ve kırılmanın iki tarafını oranlamaz", () => {
    const h = fiyatSerisiHesapla(fiyatlar, aylar, aylar[0], endeksler, [aylar[1]]);
    expect(h.satirlar[1].durum).toBe("birim_kirilmasi");
    expect(h.satirlar[1].fiyat).toBeNull();
    expect(h.satirlar[2].endeks100).toBeNull();
    expect(h.satirlar[2].aylikDegisim).toBeNull();
    expect(h.karsilastirmalar[0].reelDegisim).toBeNull();
    expect(h.karsilastirmalar[0].neden).toMatch(/Birim değişikliği/);
  });
  it("kırılma sonrasında yeni baz seçilirse aynı dönem hesaplanır", () => {
    const h = fiyatSerisiHesapla(fiyatlar, aylar, aylar[2], endeksler, [aylar[1]]);
    expect(h.satirlar[3].aylikDegisim).toBe("33.33");
    expect(h.karsilastirmalar[0].reelDegisim).toBe("33.33");
    expect(ayniBirimDonemi(aylar[0], aylar[3], [aylar[1]])).toBe(false);
  });
  it("kırılma ayı baz seçilirse gerekçe döner", () => {
    expect(fiyatSerisiHesapla(fiyatlar, aylar, aylar[1], endeksler, [aylar[1]]).karsilastirmalar[0].neden).toMatch(/Baz ayda birim/);
  });
});

describe("bağımsız özel rol kutuları", () => {
  it("aynı şablondaki iki özel rol satış ve alışa ayrı erişir", () => {
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "muhasebe", ["fiyat_endeks_alis.goruntule"], true)).toEqual({ satis: true, alis: false });
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "muhasebe", ["fiyat_endeks_satis.goruntule"], true)).toEqual({ satis: false, alis: true });
  });
  it("özel rol kutusu hazır rol listesinden bağımsızdır, Raporlar ve dış rol sınırı korunur", () => {
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "satis", ["fiyat_endeks_alis.goruntule"], true)).toEqual({ satis: true, alis: false });
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "satis")).toEqual({ satis: false, alis: false });
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "muhasebe", ["raporlar.goruntule"], true)).toEqual({ satis: false, alis: false });
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "b2b_bayi", [], true)).toEqual({ satis: false, alis: false });
  });
});
