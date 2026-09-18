import { describe, expect, it } from "vitest";
import { internetSatisEngelleri, odemeSekliUblKodu } from "./internet-satisi";

const tam = {
  internetSatisi: true,
  siparisNo: "SIP-2026-001",
  siparisTarihi: new Date("2026-09-15"),
  webAdresi: "https://magaza.example.com",
  odemeSekli: "kredi_karti",
  odemeTarihi: new Date("2026-09-15"),
  teslimatAdresiVar: true,
};

describe("internetSatisEngelleri", () => {
  it("işaret yoksa hiçbir alan aranmaz", () => {
    expect(internetSatisEngelleri({ internetSatisi: false, teslimatAdresiVar: false })).toEqual([]);
  });

  it("eksiksiz internet satışında engel üretmez", () => {
    expect(internetSatisEngelleri(tam)).toEqual([]);
  });

  it("sipariş, web adresi, ödeme ve teslimat adresini arar", () => {
    const engeller = internetSatisEngelleri({ internetSatisi: true, teslimatAdresiVar: false });
    expect(engeller.map((e) => e.alan)).toEqual([
      "siparisNo", "siparisTarihi", "webAdresi", "odemeSekli", "odemeTarihi", "teslimatAdresi",
    ]);
  });

  it("kargo bilgisi isteğe bağlıdır ama girilen VKN biçimli olmalıdır", () => {
    expect(internetSatisEngelleri({ ...tam, tasiyiciUnvan: "Kargo A.Ş." })).toEqual([]);
    expect(internetSatisEngelleri({ ...tam, tasiyiciVkn: "123" }).map((e) => e.alan)).toEqual(["tasiyiciVkn"]);
    expect(internetSatisEngelleri({ ...tam, tasiyiciVkn: "1234567890" })).toEqual([]);
  });

  it("tanımsız ödeme şeklini kabul etmez", () => {
    expect(internetSatisEngelleri({ ...tam, odemeSekli: "kripto" }).map((e) => e.alan)).toEqual(["odemeSekli"]);
  });
});

describe("odemeSekliUblKodu", () => {
  it("ödeme şeklini UN/ECE 4461 koduna çevirir", () => {
    expect(odemeSekliUblKodu("kredi_karti")).toBe("48");
    expect(odemeSekliUblKodu("havale")).toBe("30");
    expect(odemeSekliUblKodu("kapida_nakit")).toBe("10");
    expect(odemeSekliUblKodu("odeme_aracisi")).toBe("68");
    // Tanınmayan şekilde belge yine üretilir: "tanımsız" kodu gider.
    expect(odemeSekliUblKodu("kripto")).toBe("1");
    expect(odemeSekliUblKodu(null)).toBe("1");
  });
});
