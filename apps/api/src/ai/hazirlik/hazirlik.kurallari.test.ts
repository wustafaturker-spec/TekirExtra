import { describe, expect, it } from "vitest";
import {
  HAZIRLIK_DURUMLARI,
  HAZIRLIK_TURLERI,
  TUR_METINLERI,
  hazirlikGecerliMi,
  hedefOzetiHesapla,
} from "./hazirlik.kurallari";

describe("Hazirlik Kurallari", () => {
  it("5 temel hazırlık türünü tanımlar", () => {
    expect(HAZIRLIK_TURLERI).toEqual([
      "fatura_stok_esleme",
      "banka_ekstre_esleme",
      "vadesi_gecen_hatirlatma",
      "kritik_stok_talep",
      "ay_sonu_kapanis",
    ]);
    for (const tur of HAZIRLIK_TURLERI) {
      expect(TUR_METINLERI[tur].baslik).toBeTruthy();
      expect(TUR_METINLERI[tur].kisaAd).toBeTruthy();
    }
  });

  it("hazirlikGecerliMi süresi geçmemiş ve durumu hazir olanı geçerli sayar", () => {
    const gelecek = new Date(Date.now() + 3600 * 1000);
    const gecmis = new Date(Date.now() - 3600 * 1000);

    expect(hazirlikGecerliMi({ durum: "hazir", gecerlilikBitisAt: gelecek })).toBe(true);
    expect(hazirlikGecerliMi({ durum: "hazir", gecerlilikBitisAt: gecmis })).toBe(false);
    expect(hazirlikGecerliMi({ durum: "onaylandi", gecerlilikBitisAt: gelecek })).toBe(false);
    expect(hazirlikGecerliMi({ durum: "reddedildi", gecerlilikBitisAt: gelecek })).toBe(false);
  });

  it("hedefOzetiHesapla deterministik ve tutarlıdır", () => {
    const o1 = hedefOzetiHesapla({ a: 1, b: "test" });
    const o2 = hedefOzetiHesapla({ a: 1, b: "test" });
    const o3 = hedefOzetiHesapla({ a: 2, b: "test" });

    expect(o1).toBe(o2);
    expect(o1).not.toBe(o3);
    expect(o1.length).toBe(32);
    expect(hedefOzetiHesapla(null)).toBe("");
  });
});
