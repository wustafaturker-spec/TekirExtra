import { describe, expect, it } from "vitest";
import { sayiMetni } from "./yz-tablo-bicim";

describe("AI-117 kart sayı biçimi", () => {
  it("ondalık metni basamak kaybetmeden Türkçe biçimler", () => {
    expect(sayiMetni("9999999999999999.99", true)).toBe("9.999.999.999.999.999,99");
    expect(sayiMetni("125430.5", true)).toBe("125.430,50");
    expect(sayiMetni("-1250", true)).toBe("-1.250,00");
    expect(sayiMetni("1500.5")).toBe("1.500,5");
    expect(sayiMetni("12")).toBe("12");
  });
  it("para sütununda kayan nokta artığını iki haneye yuvarlar", () => {
    expect(sayiMetni("0.30000000000000004", true)).toBe("0,30");
  });
});
