import { describe, expect, it } from "vitest";
import { senaryoHatalari, tevkifatPayPayda } from "./fatura-senaryo";
import { TEVKIFAT_KODLARI, tevkifatKoduBul } from "./gib-kodlari";
import { gizliTevkifatKodlari, tevkifatTablosuKur } from "./tevkifat-ayar";

const merkez = TEVKIFAT_KODLARI.map((k) => ({ anahtar: k.kod, deger: { ad: k.ad, oranlar: [...k.oranlar] } }));

describe("varsayılan tevkifat tablosu (UBL-TR v1.42)", () => {
  it("güncel oranlar ve yeni kodlar", () => {
    expect(tevkifatKoduBul("601")?.oranlar).toEqual(["4/10"]);
    expect(tevkifatKoduBul("603")?.oranlar).toEqual(["7/10"]);
    expect(tevkifatKoduBul("612")?.oranlar).toEqual(["9/10"]);
    expect(tevkifatKoduBul("624")?.oranlar).toEqual(["2/10"]);
    expect(tevkifatKoduBul("627")?.oranlar).toEqual(["5/10"]);
  });
});

describe("firma tevkifat tablosu (MVZ-09/12)", () => {
  it("merkezi kayıtlardan kurulur; gizli kod pasif işaretlenir", () => {
    const tablo = tevkifatTablosuKur([...merkez, { anahtar: "628", deger: { ad: "YENİ", oranlar: ["3/10"] } }], ["604"]);
    expect(tevkifatKoduBul("628", tablo)).toMatchObject({ ad: "YENİ", oranlar: ["3/10"] });
    expect(tevkifatKoduBul("604", tablo)?.pasif).toBe(true);
    expect(tevkifatPayPayda("628", null, tablo)).toEqual({ pay: 3, payda: 10 });
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "604" }], false, { tevkifatTablosu: tablo })[0].mesaj).toMatch(/gizlen|pasif/);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "604" }], false, { tevkifatTablosu: tablo, pasifKodKabul: true })).toEqual([]);
  });

  it("merkezde kaldırılan (kayıt yok) kod tanımsızdır; bozuk değer tabloya girmez", () => {
    const tablo = tevkifatTablosuKur([{ anahtar: "601", deger: { ad: "X", oranlar: ["4/10"] } }, { anahtar: "699", deger: { ad: "bozuk" } }]);
    expect(tablo.map((k) => k.kod)).toEqual(["601"]);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "603" }], false, { tevkifatTablosu: tablo })[0].mesaj).toMatch(/Tanımsız/);
  });

  it("FTR-35 biçimli ayardan yalnız pasif işaretleri gizli sayılır (MVZ-15)", () => {
    expect(gizliTevkifatKodlari({ degisiklikler: [{ kod: "601", pasif: false }, { kod: "604", pasif: true }] })).toEqual(["604"]);
    expect(gizliTevkifatKodlari({ gizli: ["612", "612"] })).toEqual(["612"]);
    expect(gizliTevkifatKodlari(null)).toEqual([]);
  });

  it("taslaktaki eski oran yazısı tek oranlı kodda reddedilmez", () => {
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "601", tevkifatOrani: "3/10" }])).toEqual([]);
    expect(tevkifatPayPayda("601", "3/10")).toEqual({ pay: 4, payda: 10 });
  });
});
