import { describe, expect, it } from "vitest";
import { senaryoHatalari, tevkifatPayPayda } from "./fatura-senaryo";
import { tevkifatKoduBul } from "./gib-kodlari";
import { tevkifatAyarHatalari, tevkifatOraniGecerliMi, tevkifatTablosuCoz } from "./tevkifat-ayar";

describe("varsayılan tevkifat tablosu (UBL-TR v1.42)", () => {
  it("güncel oranlar ve yeni kodlar", () => {
    expect(tevkifatKoduBul("601")?.oranlar).toEqual(["4/10"]);
    expect(tevkifatKoduBul("603")?.oranlar).toEqual(["7/10"]);
    expect(tevkifatKoduBul("612")?.oranlar).toEqual(["9/10"]);
    expect(tevkifatKoduBul("624")?.oranlar).toEqual(["2/10"]);
    expect(tevkifatKoduBul("627")?.oranlar).toEqual(["5/10"]);
  });
});

describe("firma tevkifat tablosu (FTR-35)", () => {
  it("değişiklik yoksa varsayılan tablo", () => {
    expect(tevkifatTablosuCoz([]).find((k) => k.kod === "601")?.oranlar).toEqual(["4/10"]);
  });

  it("oran değişikliği, pasif kod ve eklenen kod tabloya yansır", () => {
    const tablo = tevkifatTablosuCoz([
      { kod: "601", oranlar: ["5/10"] },
      { kod: "604", pasif: true },
      { kod: "628", ad: "YENİ HİZMET", oranlar: ["3/10"] },
    ]);
    expect(tevkifatKoduBul("601", tablo)).toMatchObject({ oranlar: ["5/10"], ad: expect.stringContaining("YAPIM") });
    expect(tevkifatKoduBul("604", tablo)?.pasif).toBe(true);
    expect(tablo.at(-1)).toMatchObject({ kod: "628", ad: "YENİ HİZMET" });
    expect(tevkifatPayPayda("601", null, tablo)).toEqual({ pay: 5, payda: 10 });
    expect(tevkifatPayPayda("628", null, tablo)).toEqual({ pay: 3, payda: 10 });
  });

  it("senaryo kuralı firmanın tablosunu kullanır; pasif kod yeni kayıtta reddedilir", () => {
    const tablo = tevkifatTablosuCoz([{ kod: "604", pasif: true }, { kod: "628", ad: "YENİ", oranlar: ["3/10"] }]);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "628" }], false, { tevkifatTablosu: tablo })).toEqual([]);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "628" }])[0].mesaj).toMatch(/Tanımsız/);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "604" }], false, { tevkifatTablosu: tablo })[0].mesaj).toMatch(/pasif/);
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "604" }], false, { tevkifatTablosu: tablo, pasifKodKabul: true })).toEqual([]);
    // Şema (null) kod denetimini servise bırakır, sıfır KDV kuralı yine işler.
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "999" }], false, { tevkifatTablosu: null })).toEqual([]);
    expect(senaryoHatalari([{ kdvOrani: 0, gibIstisnaKodu: "351", tevkifatKodu: "999" }], false, { tevkifatTablosu: null })[0].mesaj).toMatch(/sıfır/);
  });

  it("taslaktaki eski oran yazısı tek oranlı kodda reddedilmez", () => {
    expect(senaryoHatalari([{ kdvOrani: 20, tevkifatKodu: "601", tevkifatOrani: "3/10" }])).toEqual([]);
    expect(tevkifatPayPayda("601", "3/10")).toEqual({ pay: 4, payda: 10 });
  });

  it("ayar hataları", () => {
    expect(tevkifatOraniGecerliMi("4/10")).toBe(true);
    expect(tevkifatOraniGecerliMi("11/10")).toBe(false);
    expect(tevkifatOraniGecerliMi("%40")).toBe(false);
    expect(tevkifatAyarHatalari([{ kod: "601", oranlar: ["4/10"] }])).toEqual([]);
    expect(tevkifatAyarHatalari([{ kod: "62" }])[0]).toMatch(/üç haneli/);
    expect(tevkifatAyarHatalari([{ kod: "628", oranlar: ["3/10"] }])[0]).toMatch(/adı girilmelidir/);
    expect(tevkifatAyarHatalari([{ kod: "628", ad: "X" }])[0]).toMatch(/en az bir oran/);
    expect(tevkifatAyarHatalari([{ kod: "601", oranlar: ["4/10", "4/10"] }])[0]).toMatch(/aynı oran/);
    expect(tevkifatAyarHatalari([{ kod: "601" }, { kod: "601" }])[0]).toMatch(/birden çok/);
  });
});
