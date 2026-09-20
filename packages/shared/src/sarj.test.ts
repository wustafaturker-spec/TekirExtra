import { describe, expect, it } from "vitest";
import { sarjEngelleri, sarjPlakaGecerliMi, sarjTuruCoz } from "./sarj";

const temel = {
  turu: "sarj" as const,
  plaka: "01ADS123",
  baslangic: "2026-08-25T10:00",
  bitis: "2026-08-25T11:00",
  esuRaporlari: [{ raporId: "0e76d990-7f41-4b00-a81b-d06ee787e199", tarih: "2026-08-18" }],
};

describe("sarjPlakaGecerliMi", () => {
  it("şematronun gevşek biçimini uygular", () => {
    // İrsaliyedeki il kodu kuralı burada aranmaz.
    expect(sarjPlakaGecerliMi("01ADS123")).toBe(true);
    expect(sarjPlakaGecerliMi("AFK-159")).toBe(true);
    expect(sarjPlakaGecerliMi("34 ABC 123")).toBe(true); // boşluklar atılır
    expect(sarjPlakaGecerliMi("34.ABC")).toBe(false);
    expect(sarjPlakaGecerliMi("")).toBe(false);
  });
});

describe("sarjTuruCoz", () => {
  it("türü satırlardaki stok kartlarından çözer", () => {
    expect(sarjTuruCoz([{ sarjTuru: null }, { sarjTuru: "sarj" }])).toEqual({ turu: "sarj", karisik: false });
    expect(sarjTuruCoz([{ sarjTuru: "sarjanlik" }])).toEqual({ turu: "sarjanlik", karisik: false });
    expect(sarjTuruCoz([{ sarjTuru: null }])).toEqual({ turu: null, karisik: false });
  });

  it("iki tür aynı belgede karışamaz", () => {
    expect(sarjTuruCoz([{ sarjTuru: "sarj" }, { sarjTuru: "sarjanlik" }])).toEqual({ turu: null, karisik: true });
  });
});

describe("sarjEngelleri", () => {
  it("şarj faturası değilse kural işlemez", () => {
    expect(sarjEngelleri({ turu: null, plaka: null })).toEqual([]);
  });

  it("eksiksiz şarj faturasında engel yok", () => {
    expect(sarjEngelleri(temel)).toEqual([]);
  });

  it("plaka, tarih-saat ve ESU raporu ister", () => {
    const alanlar = sarjEngelleri({ turu: "sarj" }).map((e) => e.alan);
    expect(alanlar).toEqual(["plaka", "baslangic", "bitis", "esuRaporlari"]);
  });

  it("ESU rapor kimliği GUID olmalı", () => {
    const engeller = sarjEngelleri({ ...temel, esuRaporlari: [{ raporId: "123", tarih: "2026-08-18" }] });
    expect(engeller[0].mesaj).toMatch(/GUID biçiminde/);
  });

  it("bitiş başlangıçtan önce olamaz", () => {
    expect(sarjEngelleri({ ...temel, bitis: "2026-08-25T09:00" })[0].alan).toBe("bitis");
  });

  it("şarjanlıkta her satırda ünite seri no aranır, ESU raporu aranmaz", () => {
    const engeller = sarjEngelleri({ ...temel, turu: "sarjanlik", esuRaporlari: [], satirlar: [{ sira: 1 }, { sira: 2, uniteSeriNo: "SARJCIHAZ123456" }] });
    expect(engeller).toEqual([{ alan: "uniteSeriNo", mesaj: "1. satırda şarj ünitesi seri numarası girilmelidir" }]);
  });
});
