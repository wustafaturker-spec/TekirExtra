import { describe, expect, it } from "vitest";
import { yaziyla } from "./yaziyla";

describe("yaziyla (FTR-38/40)", () => {
  it("Türkçe: bin tek başına, kuruş ayrı", () => {
    expect(yaziyla(189084, "tr", "TRY")).toBe("YÜZ SEKSEN DOKUZ BİN SEKSEN DÖRT TÜRK LİRASI");
    expect(yaziyla(1000.5, "tr", "TRY")).toBe("BİN TÜRK LİRASI ELLİ KURUŞ");
    expect(yaziyla(2_100_000, "tr", "USD")).toBe("İKİ MİLYON YÜZ BİN ABD DOLARI");
    expect(yaziyla(0, "tr", "TRY")).toBe("SIFIR TÜRK LİRASI");
  });

  it("İngilizce", () => {
    expect(yaziyla(4610, "en", "USD")).toBe("FOUR THOUSAND SIX HUNDRED TEN US DOLLARS ONLY");
    expect(yaziyla(21.05, "en", "EUR")).toBe("TWENTY-ONE EUROS AND FIVE CENTS ONLY");
  });

  it("Almanca: bileşik yazım, tek başına eins", () => {
    expect(yaziyla(1234, "de", "EUR")).toBe("eintausendzweihundertvierunddreißig Euro");
    expect(yaziyla(101, "de", "EUR")).toBe("einhunderteins Euro");
    expect(yaziyla(2_000_021.5, "de", "USD")).toBe("zwei Millionen einundzwanzig US-Dollar und fünfzig Cent");
  });

  it("Rusça: sayıya göre çekim, lira dişil", () => {
    expect(yaziyla(1, "ru", "USD")).toBe("один доллар США");
    expect(yaziyla(22, "ru", "USD")).toBe("двадцать два доллара США");
    expect(yaziyla(2, "ru", "TRY")).toBe("две турецкие лиры");
    expect(yaziyla(2011.12, "ru", "USD")).toBe("две тысячи одиннадцать долларов США двенадцать центов");
  });

  it("Arapça: فقط … لا غير ve sayılan çekimi", () => {
    expect(yaziyla(4610, "ar", "USD")).toBe("فقط أربعة آلاف وستمائة وعشرة دولارات أمريكية لا غير");
    expect(yaziyla(5, "ar", "USD")).toBe("فقط خمسة دولارات أمريكية لا غير");
    expect(yaziyla(1, "ar", "USD")).toBe("فقط دولار أمريكي لا غير");
    expect(yaziyla(1000, "ar", "EUR")).toBe("فقط ألف يورو لا غير");
  });

  it("bilinmeyen döviz kodla ve /100 ile yazılır", () => {
    expect(yaziyla(12.3, "en", "QAR")).toBe("TWELVE QAR AND 30/100 ONLY");
  });
});
