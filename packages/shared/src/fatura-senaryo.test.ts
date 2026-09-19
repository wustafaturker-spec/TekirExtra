import { describe, expect, it } from "vitest";
import { faturaSenaryosuTuret, izinliIstisnaKodlari, senaryoHatalari } from "./fatura-senaryo";

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
