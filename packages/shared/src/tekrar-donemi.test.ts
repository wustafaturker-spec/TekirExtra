import { describe, expect, it } from "vitest";
import { bilinmeyenTekrarDegiskenleri, faturalananDonemAraligi, oncekiTekrarTarihi, sonrakiTekrarTarihi, tekrarDegiskenDegerleri, tekrarMetniDoldur } from "./tekrar-donemi";

const g = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("FTR-44 tekrar takvimi", () => {
  it("FTR-10 sonraki tarih davranışını korur", () => {
    expect(iso(sonrakiTekrarTarihi(g("2026-11-03"), "haftalik", 2))).toBe("2026-11-17");
    expect(iso(sonrakiTekrarTarihi(g("2026-01-31"), "aylik", 1))).toBe("2026-02-28");
    expect(iso(sonrakiTekrarTarihi(g("2026-11-03"), "aylik", 3))).toBe("2027-02-03");
    expect(iso(sonrakiTekrarTarihi(g("2028-02-29"), "yillik", 1))).toBe("2029-02-28");
  });

  it("önceki tarih ay sonunu kırpar", () => {
    expect(iso(oncekiTekrarTarihi(g("2026-03-31"), "aylik", 1))).toBe("2026-02-28");
    expect(iso(oncekiTekrarTarihi(g("2026-11-03"), "haftalik", 1))).toBe("2026-10-27");
  });

  it("bu dönem ve önceki dönem aralıkları", () => {
    const bu = faturalananDonemAraligi(g("2026-11-03"), "aylik", 1, "bu_donem");
    expect([iso(bu.bas), iso(bu.bit)]).toEqual(["2026-11-03", "2026-12-02"]);
    const onceki = faturalananDonemAraligi(g("2026-11-01"), "aylik", 1, "onceki_donem");
    expect([iso(onceki.bas), iso(onceki.bit)]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("değişken değerleri dönem başından gelir", () => {
    expect(tekrarDegiskenDegerleri(g("2026-01-01"), "aylik", 1, "onceki_donem")).toEqual({
      AY: "12", AY_ADI: "Aralık", YIL: "2025", DONEM_BAS: "01.12.2025", DONEM_BIT: "31.12.2025",
    });
  });
});

describe("FTR-44 metin doldurma", () => {
  const d = tekrarDegiskenDegerleri(g("2026-11-03"), "aylik", 1, "bu_donem");
  it("bilinen değişkenleri doldurur, boşluklu yazımı kabul eder", () => {
    expect(tekrarMetniDoldur("{{AY_ADI}} {{ YIL }} kira ({{DONEM_BAS}}–{{DONEM_BIT}})", d)).toBe("Kasım 2026 kira (03.11.2026–02.12.2026)");
  });
  it("bilinmeyen değişkeni bulur ve olduğu gibi bırakır", () => {
    expect(bilinmeyenTekrarDegiskenleri("{{AY}} {{AYY}} {{ay}} {{AYY}}")).toEqual(["AYY", "ay"]);
    expect(tekrarMetniDoldur("{{AYY}}", d)).toBe("{{AYY}}");
  });
});
