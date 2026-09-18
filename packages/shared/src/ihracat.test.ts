import { describe, expect, it } from "vitest";
import {
  aliciUlkeKodu,
  gtipGecerliMi,
  gtipNormalize,
  ihracatEngelleri,
  ihracatFaturasiMi,
  ihracatIstisnaKodu,
  ihracatIstisnaKoduMu,
  menseiUyarilari,
} from "./ihracat";

const satir = (ek: Partial<Parameters<typeof menseiUyarilari>[0][number]> = {}) => ({
  sira: 1,
  stokAdi: "Ürün",
  stokTipi: "urun",
  gtipKodu: "123456789012",
  mensei: "TR",
  kdvOrani: 0,
  ...ek,
});

describe("ihracat kanalı", () => {
  it("alıcının ülkesini adres sırasına göre çözer: önce fatura adresi", () => {
    expect(
      aliciUlkeKodu([
        { tip: "sevk", ulke: "TR" },
        { tip: "fatura", ulke: "DE" },
      ]),
    ).toBe("DE");
    expect(aliciUlkeKodu([{ tip: "merkez", ulke: "Almanya" }])).toBe("DE");
  });

  it("adres yoksa yurt içi sayar — ihracat kayıtlı bir yurt dışı adrese dayanır", () => {
    expect(ihracatFaturasiMi([])).toBe(false);
    expect(ihracatFaturasiMi([{ tip: "fatura", ulke: null }])).toBe(false);
    expect(ihracatFaturasiMi([{ tip: "fatura", ulke: "TR" }])).toBe(false);
    expect(ihracatFaturasiMi([{ tip: "fatura", ulke: "de" }])).toBe(true);
  });
});

describe("ihracat istisna kodu", () => {
  it("mal ihracatında 301, hizmet ihracatında 302 kullanılır", () => {
    // Tasarım belgesi 351 diyordu; 351 GİB listesinde "İstisna Olmayan Diğer"
    // demektir ve ihracatı istisna saydırmaz.
    expect(ihracatIstisnaKodu("urun")).toBe("301");
    expect(ihracatIstisnaKodu("hizmet")).toBe("302");
    expect(ihracatIstisnaKodu(null)).toBe("301");
    expect(ihracatIstisnaKoduMu("351")).toBe(false);
    expect(ihracatIstisnaKoduMu("316")).toBe(true);
  });
});

describe("GTİP", () => {
  it("tam 12 rakam ister", () => {
    expect(gtipGecerliMi("123456789012")).toBe(true);
    expect(gtipGecerliMi("1234 5678 9012")).toBe(true);
    expect(gtipGecerliMi("12345678")).toBe(false);
    expect(gtipGecerliMi("12345678901A")).toBe(false);
    expect(gtipNormalize("1234 5678 9012")).toBe("123456789012");
    expect(gtipNormalize("123")).toBeUndefined();
  });
});

describe("ihracatEngelleri", () => {
  it("eksiksiz ihracatta engel üretmez", () => {
    expect(ihracatEngelleri("DE", { teslimTarihi: new Date("2026-09-18"), teslimSarti: "FOB", tasimaSekli: "3" }, [satir()])).toEqual([]);
  });

  it("fiili ihracat tarihi, GTİP ve sıfır KDV'yi arar", () => {
    const engeller = ihracatEngelleri("DE", {}, [
      satir({ sira: 1, gtipKodu: null }),
      satir({ sira: 2, stokAdi: "Hizmet", kdvOrani: 20 }),
    ]);
    expect(engeller.map((e) => e.alan).sort()).toEqual(["gtip", "kdv", "teslimTarihi"]);
    expect(engeller.find((e) => e.alan === "gtip")!.mesaj).toContain("1. Ürün");
    expect(engeller.find((e) => e.alan === "kdv")!.mesaj).toContain("2. Hizmet");
  });

  it("ülke TR ise ihracat alanları doldurulsa bile engel kalır", () => {
    const engeller = ihracatEngelleri("TR", { teslimTarihi: new Date() }, [satir()]);
    expect(engeller.map((e) => e.alan)).toEqual(["ulke"]);
  });

  it("tanımsız teslim şartı ve taşıma şeklini reddeder", () => {
    const engeller = ihracatEngelleri("DE", { teslimTarihi: new Date(), teslimSarti: "XXX", tasimaSekli: "9" }, [satir()]);
    expect(engeller.map((e) => e.alan)).toEqual(["teslimSarti", "tasimaSekli"]);
  });
});

describe("menseiUyarilari", () => {
  it("çözülemeyen menşeiyi bildirir, boş menşeiyi bildirmez", () => {
    expect(menseiUyarilari([satir({ mensei: "Türkiye" }), satir({ sira: 2, mensei: null })])).toEqual([]);
    expect(menseiUyarilari([satir({ sira: 3, mensei: "Zımbırtistan" })])).toEqual([
      { sira: 3, stokAdi: "Ürün", mensei: "Zımbırtistan" },
    ]);
  });
});
