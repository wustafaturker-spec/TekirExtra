import { describe, expect, it } from "vitest";
import { csvHucresi, csvSatirlari, tabloMetniGuvenli } from "./tablo-hucresi";

describe("SEC-09 tablo hücresi", () => {
  it("formülle başlayan metin etkisizleşir", () => {
    for (const m of ["=1+1", '=HYPERLINK("http://k.example","tıkla")', "+cmd|' /C calc'!A0", "-2+3+cmd|' /C calc'!A0", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(tabloMetniGuvenli(m)).toBe(`'${m}`);
    }
  });
  it("sayılar, eksi tutarlar ve sıradan metin değişmez", () => {
    for (const m of ["-12,50", "-1.234,56", "+5", "-3%", "ACME A.Ş.", "Ödeme - Ekim", ""]) expect(tabloMetniGuvenli(m)).toBe(m);
  });
  it("CSV hücresi tırnaklanır, iç tırnak ikilenir, sayı korunur", () => {
    expect(csvHucresi('=A1 "x"')).toBe(`"'=A1 ""x"""`);
    expect(csvHucresi(-12.5)).toBe('"-12.5"');
    expect(csvHucresi(null)).toBe('""');
    expect(csvSatirlari([["Cari", "Tutar"], ["=cmd", "-5,00"]])).toBe(`"Cari";"Tutar"\n"'=cmd";"-5,00"`);
  });
});
