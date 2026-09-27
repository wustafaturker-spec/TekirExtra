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
  yurtDisiAliciMi,
  yurtDisiEarsivEngelleri,
  yurtDisiSatisTuru,
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

  it("kap isteğe bağlıdır; numara ya da adet girilmişse kap cinsi ister (EBLG-103)", () => {
    const bilgi = { teslimTarihi: new Date() };
    expect(ihracatEngelleri("DE", bilgi, [satir(), satir({ sira: 2, kapCinsi: "BX", kapAdet: 3, kapNo: "K-1" })])).toEqual([]);
    const engeller = ihracatEngelleri("DE", bilgi, [
      satir({ sira: 1, kapAdet: 2 }),
      satir({ sira: 2, stokAdi: "Koli", kapNo: "K-2", kapCinsi: "ZZZ" }),
      satir({ sira: 3, kapCinsi: "PX" }),
    ]);
    expect(engeller.map((e) => e.alan)).toEqual(["kap"]);
    expect(engeller[0]!.mesaj).toContain("1. Ürün, 2. Koli");
    // e-Arşiv istisna yolunda kap bilgisi hiç aranmaz.
    expect(yurtDisiEarsivEngelleri("DE", [satir({ kapAdet: 2 })])).toEqual([]);
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

describe("yurt dışı alıcı (EBLG-80)", () => {
  it("adres ülkesi Türkiye dışıysa ya da kartta yurt dışı VKN'si varsa yurt dışıdır", () => {
    expect(yurtDisiAliciMi({ ulkeKodu: "DE", vknTckn: null })).toBe(true);
    expect(yurtDisiAliciMi({ ulkeKodu: undefined, vknTckn: "2222222222" })).toBe(true);
    expect(yurtDisiAliciMi({ ulkeKodu: "TR", vknTckn: "1460415308" })).toBe(true);
    expect(yurtDisiAliciMi({ ulkeKodu: "TR", vknTckn: "1234567802" })).toBe(false);
    expect(yurtDisiAliciMi({ ulkeKodu: undefined, vknTckn: null })).toBe(false);
  });

  it("mal satışında e-Fatura kullanan firma ihracat faturası keser", () => {
    expect(yurtDisiSatisTuru({ efaturaAcik: true, stokTipleri: ["urun", "urun"] })).toBe("ihracat");
  });

  it("e-Fatura kullanmayan firma, hizmet ya da karışık satış e-Arşiv istisna keser", () => {
    expect(yurtDisiSatisTuru({ efaturaAcik: false, stokTipleri: ["urun"] })).toBe("earsiv_istisna");
    expect(yurtDisiSatisTuru({ efaturaAcik: true, stokTipleri: ["hizmet"] })).toBe("earsiv_istisna");
    expect(yurtDisiSatisTuru({ efaturaAcik: true, stokTipleri: ["urun", "hizmet"] })).toBe("earsiv_istisna");
  });

  it("e-Arşiv yolunda gümrük alanları istenmez; ülke ve sıfır KDV istenir", () => {
    expect(yurtDisiEarsivEngelleri("DE", [satir({ gtipKodu: null })])).toEqual([]);
    expect(yurtDisiEarsivEngelleri(undefined, [satir({ kdvOrani: 20 })]).map((e) => e.alan)).toEqual(["ulke", "kdv"]);
  });
});
