import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";
import { mevzuatParametreleriSemasi } from "./mevzuat.semalar";
import { RESMI_MEVZUAT_SETLERI } from "./resmi-mevzuat";

describe("resmî mevzuat setleri (PRS-11)", () => {
  for (const set of RESMI_MEVZUAT_SETLERI) {
    it(`${set.kod}: şema geçer, kabul senaryoları kuruşu kuruşuna tutar`, () => {
      expect(mevzuatParametreleriSemasi.safeParse(set.parametreler).success).toBe(true);
      for (const s of set.kabulSenaryolari) {
        const sonuc = bordroHesapla(set.parametreler, s.girdiler as never) as unknown as Record<string, string>;
        for (const [alan, beklenen] of Object.entries(s.beklenen)) expect(Number(sonuc[alan]), `${s.ad} · ${alan}`).toBeCloseTo(beklenen, 2);
      }
    });
  }
  it("yürürlükler çakışmaz ve yılı kapsar", () => {
    const [a, b] = RESMI_MEVZUAT_SETLERI;
    expect(a.yururlukBitis! < b.yururlukBaslangic).toBe(true);
    expect(a.yururlukBaslangic).toBe("2026-01-01");
    expect(b.yururlukBitis).toBe("2026-12-31");
  });
  it("yemek: Ocak–Nisan SGK 260,39 (%23,65), Mayıs+ 300", () => {
    expect(RESMI_MEVZUAT_SETLERI[0].parametreler.yemekSgkGunlukIstisna).toBe(Math.round(33030 / 30 * 0.2365 * 100) / 100);
    expect(RESMI_MEVZUAT_SETLERI[1].parametreler.yemekSgkGunlukIstisna).toBe(300);
  });
});
