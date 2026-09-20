import { describe, expect, it } from "vitest";
import { sgkBelgeAlanlari, sgkEngelleri, sgkFaturasiMi, SGK_VKN } from "./sgk";

describe("sgkFaturasiMi", () => {
  it("yalnız SGK'nın VKN'sinde doğrudur", () => {
    expect(sgkFaturasiMi(SGK_VKN)).toBe(true);
    expect(sgkFaturasiMi("7750409379")).toBe(true);
    expect(sgkFaturasiMi("1234567801")).toBe(false);
    expect(sgkFaturasiMi(null)).toBe(false);
  });
});

describe("sgkEngelleri", () => {
  it("ilave fatura tipi seçilmeden başka bir şey sorulmaz", () => {
    expect(sgkEngelleri({})).toEqual([{ alan: "ilaveFaturaTipi", mesaj: "SGK faturasında ilave fatura tipi seçilmelidir" }]);
    expect(sgkEngelleri({ ilaveFaturaTipi: "YOK" })[0].alan).toBe("ilaveFaturaTipi");
  });

  it("hastanede kod, ad, dosya no ve dönem ister", () => {
    const alanlar = sgkEngelleri({ ilaveFaturaTipi: "SAGLIK_HAS" }).map((e) => e.alan);
    expect(alanlar).toEqual(["mukellefKodu", "mukellefAdi", "dosyaNo", "donemBaslangic", "donemBitis"]);
    expect(sgkEngelleri({
      ilaveFaturaTipi: "SAGLIK_HAS", mukellefKodu: "0000", mukellefAdi: "Özel Deneme Hastanesi",
      dosyaNo: "798564", donemBaslangic: "2026-09-01", donemBitis: "2026-09-30",
    })).toEqual([]);
  });

  it("mal/hizmet alımında dönem sorulmaz, dosya no sorulur", () => {
    expect(sgkEngelleri({ ilaveFaturaTipi: "MAL_HIZMET" }).map((e) => e.alan)).toEqual(["dosyaNo"]);
    expect(sgkEngelleri({ ilaveFaturaTipi: "MAL_HIZMET", dosyaNo: "1136" })).toEqual([]);
  });

  it("diğer grubunda hiçbir ek alan istenmez", () => {
    expect(sgkEngelleri({ ilaveFaturaTipi: "DIGER" })).toEqual([]);
  });

  it("dönem bitişi başlangıcından önce olamaz", () => {
    const engeller = sgkEngelleri({
      ilaveFaturaTipi: "ABONELIK", dosyaNo: "ABN-1", donemBaslangic: "2026-09-30", donemBitis: "2026-09-01",
    });
    expect(engeller.map((e) => e.alan)).toEqual(["donemBitis"]);
  });
});

describe("sgkBelgeAlanlari", () => {
  it("gruba girmeyen alanları belgeye yazmaz", () => {
    const alanlar = sgkBelgeAlanlari({
      ilaveFaturaTipi: "MAL_HIZMET", mukellefKodu: "123", mukellefAdi: "Yazılmamalı",
      dosyaNo: "1136", donemBaslangic: "2026-09-01", donemBitis: "2026-09-30",
    });
    expect(alanlar).toEqual({
      ilaveFaturaTipi: "MAL_HIZMET",
      mukellefKodu: undefined,
      mukellefAdi: undefined,
      dosyaNo: { deger: "1136", aciklama: "Harcama referans no (yoksa harcama birim no)" },
      donem: undefined,
    });
  });

  it("eczanede kodu, adı, dosya noyu ve dönemi açıklamalarıyla verir", () => {
    const alanlar = sgkBelgeAlanlari({
      ilaveFaturaTipi: "SAGLIK_ECZ", mukellefKodu: "15425689", mukellefAdi: "DENEME ECZANESİ",
      dosyaNo: "798564", donemBaslangic: "2026-09-01", donemBitis: "2026-09-30",
    })!;
    expect(alanlar.mukellefKodu).toEqual({ deger: "15425689", aciklama: "Eczane sicil numarası" });
    expect(alanlar.donem).toEqual({ baslangic: "2026-09-01", bitis: "2026-09-30" });
  });
});
