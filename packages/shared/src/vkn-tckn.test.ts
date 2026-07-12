import { describe, expect, it } from "vitest";
import { tcknGecerliMi, vknGecerliMi, vknTcknGecerliMi } from "./vkn-tckn";

describe("vknGecerliMi", () => {
  it("geçerli VKN'leri kabul eder", () => {
    // Algoritmadan üretilmiş doğrulama setleri
    expect(vknGecerliMi("1234567890")).toBe(true);
    expect(vknGecerliMi("1111111114")).toBe(true);
  });

  it("yanlış kontrol hanesini reddeder", () => {
    expect(vknGecerliMi("1234567891")).toBe(false);
    expect(vknGecerliMi("1111111111")).toBe(false);
  });

  it("format hatalarını reddeder", () => {
    expect(vknGecerliMi("123456789")).toBe(false); // 9 hane
    expect(vknGecerliMi("12345678901")).toBe(false); // 11 hane
    expect(vknGecerliMi("12345abc90")).toBe(false);
  });
});

describe("tcknGecerliMi", () => {
  it("geçerli TCKN'yi kabul eder", () => {
    // NVİ'nin bilinen test numarası
    expect(tcknGecerliMi("10000000146")).toBe(true);
  });

  it("yanlış kontrol hanelerini reddeder", () => {
    expect(tcknGecerliMi("10000000145")).toBe(false);
    expect(tcknGecerliMi("10000000156")).toBe(false);
  });

  it("sıfırla başlayan ve hatalı formatı reddeder", () => {
    expect(tcknGecerliMi("01000000146")).toBe(false);
    expect(tcknGecerliMi("1000000014")).toBe(false);
  });
});

describe("vknTcknGecerliMi", () => {
  it("haneye göre doğru algoritmayı seçer", () => {
    expect(vknTcknGecerliMi("1234567890")).toBe(true);
    expect(vknTcknGecerliMi("10000000146")).toBe(true);
    expect(vknTcknGecerliMi("123")).toBe(false);
  });
});
