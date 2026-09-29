import { describe, expect, it } from "vitest";
import { ihracKayitliSonTarih } from "./gib-kodlari";
import { faturaSenaryosuTuret, ihracKayitliHatalari, izinliIstisnaKodlari, senaryoHatalari } from "./fatura-senaryo";

// Kurallar GİB şematronundan (NES önizlemesiyle denendi, 2026-09-19 — EBLG-59).
describe("fatura senaryosu türetme", () => {
  it("351 faturayı ISTISNA yapmaz, 201–350 yapar", () => {
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 0, gibIstisnaKodu: "351" }])).toBe("satis");
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 20 }, { kdvOrani: 0, gibIstisnaKodu: "351" }])).toBe("satis");
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 0, gibIstisnaKodu: "201" }])).toBe("istisna");
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 20 }, { kdvOrani: 0, gibIstisnaKodu: "301" }])).toBe("istisna");
  });

  it("iade, istisna kodu taşısa da IADE kalır", () => {
    expect(faturaSenaryosuTuret("alis_iade", [{ kdvOrani: 0, gibIstisnaKodu: "201" }])).toBe("iade");
  });

  it("tevkifatlı iade TEVKIFATIADE olur (EBLG-61)", () => {
    expect(faturaSenaryosuTuret("alis_iade", [{ kdvOrani: 20, tevkifatKodu: "602" }])).toBe("tevkifatiade");
    expect(faturaSenaryosuTuret("alis_iade", [{ kdvOrani: 20 }])).toBe("iade");
  });

  it("tevkifat önceliklidir", () => {
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 20, tevkifatKodu: "602" }, { kdvOrani: 0, gibIstisnaKodu: "351" }])).toBe("tevkifat");
  });
});

describe("istisna kodunun fatura tipine göre süzülmesi", () => {
  it("tevkifatlı faturada yalnız 351 seçilebilir", () => {
    expect(izinliIstisnaKodlari([{ tevkifatKodu: "602" }, {}]).map((k) => k.kod)).toEqual(["351"]);
    expect(izinliIstisnaKodlari([{}]).length).toBeGreaterThan(1);
  });

  it("tevkifatlı faturada 201–350'yi reddeder, 351'i kabul eder", () => {
    const tevkifatli = { kdvOrani: 20, tevkifatKodu: "602" };
    expect(senaryoHatalari([tevkifatli, { kdvOrani: 0, gibIstisnaKodu: "201" }]).map((h) => h.satirIndeksi)).toEqual([1]);
    expect(senaryoHatalari([tevkifatli, { kdvOrani: 0, gibIstisnaKodu: "351" }])).toEqual([]);
  });
});

describe("ihraç kayıtlı satış (EBLG-60)", () => {
  it("faturada işaretlenince tip IHRACKAYITLI olur, satırlar ne olursa olsun", () => {
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 10 }], "701")).toBe("ihrackayitli");
    expect(faturaSenaryosuTuret("satis", [{ kdvOrani: 10 }], null)).toBe("satis");
  });

  it("yalnız satışta, tevkifatsız ve tanımlı kodla kabul eder", () => {
    expect(ihracKayitliHatalari({ tip: "satis", ihracKayitliKodu: "701", satirlar: [{}] })).toEqual([]);
    expect(ihracKayitliHatalari({ tip: "satis", ihracKayitliKodu: "703", satirlar: [{}] })).toHaveLength(1);
    // EBLG-114: gelen ihraç kayıtlı e-Faturadan oluşan alış faturası kodu taşır; iade taşımaz.
    expect(ihracKayitliHatalari({ tip: "alis", ihracKayitliKodu: "701", satirlar: [{}] })).toEqual([]);
    expect(ihracKayitliHatalari({ tip: "satis_iade", ihracKayitliKodu: "701", satirlar: [{}] })).toHaveLength(1);
    expect(ihracKayitliHatalari({ tip: "satis", ihracKayitliKodu: "702", satirlar: [{ tevkifatKodu: "602" }] })).toHaveLength(1);
  });
});

describe("ihraç kayıtlı son tarihi (EBLG-63)", () => {
  it("teslimi izleyen ay başından itibaren 3 ayın son günüdür", () => {
    expect(ihracKayitliSonTarih("2026-09-19")).toBe("2026-12-31");
    expect(ihracKayitliSonTarih("2026-09-01")).toBe("2026-12-31");
    expect(ihracKayitliSonTarih("2026-11-30")).toBe("2027-02-28");
    expect(ihracKayitliSonTarih(new Date("2026-12-15T00:00:00Z"))).toBe("2027-03-31");
  });
});
