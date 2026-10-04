import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";
import { cikisHesapla, hizmetGunu, ihbarHaftasi, kidemTavani, CIKIS_NEDENLERI } from "./cikis-hesabi";
import { RESMI_MEVZUAT_SETLERI } from "./resmi-mevzuat";

const t = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("çıkış hesabı (PRS-18)", () => {
  it("kıdem tavanı fesih tarihine göre", () => {
    expect(kidemTavani(t("2026-06-30"))).toBe(64948.77);
    expect(kidemTavani(t("2026-07-01"))).toBe(73729.87);
    expect(() => kidemTavani(t("2027-01-01"))).toThrow(/tavanı tanımlı değil/);
  });
  it("ihbar haftası kıdeme göre", () => {
    expect([100, 183, 547, 548, 1095, 1096, 4000].map(ihbarHaftasi)).toEqual([2, 4, 4, 6, 6, 8, 8]);
  });
  it("tavanı aşan ücrette kıdem tavandan; artan gün orantılı; ihbar ve izin", () => {
    // 2019-03-15 → 2026-10-15: 2772 gün
    const r = cikisHesapla({ girisTarihi: t("2019-03-15"), cikisTarihi: t("2026-10-15"), kidemHakki: true, ihbarDurumu: "isveren_oder", sonBrut: 80000, yanOdemeler: 6000, izinGunu: 10 });
    expect(r.hizmetGunu).toBe(hizmetGunu(t("2019-03-15"), t("2026-10-15")));
    expect(r.kidemEsasi).toBe(73729.87);
    expect(r.kidemTutari).toBe(Math.round(73729.87 * r.hizmetGunu / 365 * 100) / 100);
    expect(r.ihbarHaftasi).toBe(8);
    expect(r.ihbarTutari).toBe(Math.round(86000 / 30 * 56 * 100) / 100);
    expect(r.izinUcreti).toBe(Math.round(80000 / 30 * 10 * 100) / 100);
  });
  it("1 yıldan az hizmette kıdem yok; istifada ihbar yok", () => {
    const r = cikisHesapla({ girisTarihi: t("2026-01-10"), cikisTarihi: t("2026-10-15"), kidemHakki: true, ihbarDurumu: "yok", sonBrut: 40000, yanOdemeler: 0, izinGunu: 0 });
    expect(r.kidemTutari).toBe(0);
    expect(r.kidemUyari).toMatch(/1 yıldan az/);
    expect(r.ihbarTutari).toBe(0);
    expect(CIKIS_NEDENLERI.istifa.kidem).toBe(false);
    expect(CIKIS_NEDENLERI.isveren_fesih.ihbar).toBe("isveren_oder");
  });
  it("motor: kıdem yalnız damga, ihbar GV+DV (SGK yok), izin ücreti SGK'lı", () => {
    const p = RESMI_MEVZUAT_SETLERI[1].parametreler;
    const temel = { brutUcret: 40000, primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 };
    const yalin = bordroHesapla(p, temel);
    const kidemli = bordroHesapla(p, { ...temel, kidemTazminati: 100000 });
    expect(kidemli.sgkIsci).toBe(yalin.sgkIsci);
    expect(kidemli.gelirVergisi).toBe(yalin.gelirVergisi);
    expect(Number(kidemli.damgaVergisi) - Number(yalin.damgaVergisi)).toBeCloseTo(759, 2);
    expect(Number(kidemli.netUcret) - Number(yalin.netUcret)).toBeCloseTo(100000 - 759, 2);
    const ihbarli = bordroHesapla(p, { ...temel, ihbarTazminati: 20000 });
    expect(ihbarli.sgkIsci).toBe(yalin.sgkIsci);
    expect(Number(ihbarli.gelirVergisi)).toBeGreaterThan(Number(yalin.gelirVergisi));
    const izinli = bordroHesapla(p, { ...temel, izinUcreti: 10000 });
    expect(Number(izinli.sgkIsci) - Number(yalin.sgkIsci)).toBeCloseTo(1400, 2);
  });
});
