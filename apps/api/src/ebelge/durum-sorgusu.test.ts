import { describe, expect, it } from "vitest";
import { durumSorgusuEngeli } from "./durum-sorgusu";

describe("durumSorgusuEngeli (EBLG-38)", () => {
  it("kaydı olmayan faturayı sorguya almaz", () => {
    expect(durumSorgusuEngeli(null)).toMatch("kaydı bulunamadı");
  });

  it("entegratöre ulaşmamış belgeyi sorguya almaz", () => {
    expect(durumSorgusuEngeli({ durum: "kuyrukta", entegratorRef: null })).toMatch("Gönderimi yapılmamış");
  });

  it("son durumdaki belgeyi yeniden sorgulamaz", () => {
    for (const durum of ["kabul", "ret", "hata"]) {
      expect(durumSorgusuEngeli({ durum, entegratorRef: "REF-1" })).toMatch("son durumuna");
    }
  });

  it("referanslı bekleyen belgeyi sorguya alır", () => {
    expect(durumSorgusuEngeli({ durum: "kuyrukta", entegratorRef: "REF-1" })).toBeNull();
    expect(durumSorgusuEngeli({ durum: "iletildi", entegratorRef: "EARSIV:1" })).toBeNull();
  });
});
