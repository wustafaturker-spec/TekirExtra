import { describe, expect, it } from "vitest";
import { GIZLI_DEGER, degisiklikleriBul } from "./denetim-farki";

describe("denetim farkı (yönetim P1-4)", () => {
  it("yalnız değişen alanları eski → yeni olarak verir; iç içe alan noktalı yolla", () => {
    expect(degisiklikleriBul({ unvan: "A", adres: { il: "İzmir", ilce: "Bornova" }, vkn: "1" }, { unvan: "B", adres: { il: "İzmir", ilce: "Konak" }, vkn: "1" }))
      .toEqual({ unvan: { eski: "A", yeni: "B" }, "adres.ilce": { eski: "Bornova", yeni: "Konak" } });
  });

  it("eklenen ve kaldırılan alanı null ile gösterir; undefined/null/eksik aynı sayılır", () => {
    expect(degisiklikleriBul({ a: 1, b: null }, { a: 1, c: 2 })).toEqual({ c: { eski: null, yeni: 2 } });
  });

  it("gizli alanların değerini yazmaz, yalnız değiştiğini gösterir", () => {
    const f = degisiklikleriBul(
      { parola: "eski-sifre", sifreliParola: "x1", apiAnahtari: "k1", kullaniciAdi: "ali", host: "smtp.a" },
      { parola: "yeni-sifre", sifreliParola: "x2", apiAnahtari: "", kullaniciAdi: "veli", host: "smtp.b" },
      { gizli: ["kullaniciAdi"] },
    );
    expect(f).toEqual({
      parola: { eski: GIZLI_DEGER, yeni: GIZLI_DEGER },
      sifreliParola: { eski: GIZLI_DEGER, yeni: GIZLI_DEGER },
      apiAnahtari: { eski: GIZLI_DEGER, yeni: null },
      kullaniciAdi: { eski: GIZLI_DEGER, yeni: GIZLI_DEGER },
      host: { eski: "smtp.a", yeni: "smtp.b" },
    });
    expect(JSON.stringify(f)).not.toMatch(/eski-sifre|yeni-sifre|veli|k1/);
  });

  it("uzun metni ve büyük diziyi kısaltır", () => {
    const f = degisiklikleriBul({ not: "a", liste: [] }, { not: "x".repeat(500), liste: Array.from({ length: 50 }, (_, i) => i) });
    expect(String(f.not.yeni)).toHaveLength(301);
    expect(f.liste.yeni).toBe("[50 öğe]");
  });

  it("haric tutulan alanı karşılaştırmaz", () => {
    expect(degisiklikleriBul({ guncellendiAt: "1", a: 1 }, { guncellendiAt: "2", a: 1 }, { haric: ["guncellendiAt"] })).toEqual({});
  });
});
