import { describe, expect, it } from "vitest";
import { mevzuatDegerHatalari, mevzuatDegerOzeti, oncekiGun } from "./mevzuat";

describe("mevzuat değer doğrulaması (MVZ)", () => {
  it("tevkifat kodu: üç haneli kod, ad ve geçerli oran listesi", () => {
    expect(mevzuatDegerHatalari("tevkifat_kodu", "601", { ad: "YAPIM", oranlar: ["4/10"] })).toEqual([]);
    expect(mevzuatDegerHatalari("tevkifat_kodu", "61", { ad: "X", oranlar: ["4/10"] })[0]).toMatch(/Kod geçersiz/);
    expect(mevzuatDegerHatalari("tevkifat_kodu", "601", { oranlar: ["4/10"] })[0]).toMatch(/Ad zorunludur/);
    expect(mevzuatDegerHatalari("tevkifat_kodu", "601", { ad: "X", oranlar: ["11/10"] })[0]).toMatch(/geçersiz: 11\/10/);
    expect(mevzuatDegerHatalari("tevkifat_kodu", "601", { ad: "X", oranlar: ["4/10", "4/10"] })[0]).toMatch(/birden çok/);
    expect(mevzuatDegerHatalari("tevkifat_kodu", "601", { ad: "X", oranlar: ["4/10"], fazla: 1 })[0]).toMatch(/Bilinmeyen alan/);
  });

  it("KDV oranı, istisna türü ve kanuni değer", () => {
    expect(mevzuatDegerHatalari("kdv_orani", "20", {})).toEqual([]);
    expect(mevzuatDegerHatalari("kdv_orani", "120", {})[0]).toMatch(/aşamaz|geçersiz/);
    expect(mevzuatDegerHatalari("kdv_istisna_kodu", "301", { ad: "Mal ihracatı", istisnaTuru: "yarim" })[0]).toMatch(/İstisna türü geçersiz/);
    expect(mevzuatDegerHatalari("kanuni_deger", "babs_esigi", { deger: 5000 })).toEqual([]);
    expect(mevzuatDegerHatalari("kanuni_deger", "bilinmeyen", { deger: 5 })[0]).toMatch(/Tanımsız kanuni değer/);
    expect(mevzuatDegerHatalari("kanuni_deger", "babs_esigi", { deger: "5000" })[0]).toMatch(/sayı/);
    expect(mevzuatDegerHatalari("olmayan_tur", "x", {})[0]).toMatch(/Tanımsız mevzuat türü/);
  });

  it("özet ve tarih yardımcıları", () => {
    expect(mevzuatDegerOzeti("tevkifat_kodu", { ad: "YAPIM", oranlar: ["4/10"] })).toBe("YAPIM · 4/10");
    expect(mevzuatDegerOzeti("kdv_istisna_kodu", { ad: "İhracat", istisnaTuru: "tam" })).toBe("İhracat · Tam istisna");
    expect(oncekiGun("2024-03-01")).toBe("2024-02-29");
    expect(oncekiGun("2026-01-01")).toBe("2025-12-31");
  });
});
