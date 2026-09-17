import { describe, expect, it } from "vitest";
import { HATA_YERLESME_MS, yerlesmisHataKosulu, yerlesmisHataMi } from "./yerlesmis-hata";

const simdi = Date.UTC(2026, 8, 17, 12);
const oncesi = (ms: number) => new Date(simdi - ms);

describe("yerlesmisHataMi (EBLG-46)", () => {
  it("yeni düşen hatayı bulgu saymaz — kuyruk hâlâ deniyor olabilir", () => {
    expect(yerlesmisHataMi({ durum: "hata", updatedAt: oncesi(30_000) }, simdi)).toBe(false);
  });

  it("denemeler bittikten sonra dokunulmamış hatayı bulgu sayar", () => {
    expect(yerlesmisHataMi({ durum: "hata", updatedAt: oncesi(HATA_YERLESME_MS) }, simdi)).toBe(true);
    expect(yerlesmisHataMi({ durum: "hata", updatedAt: oncesi(HATA_YERLESME_MS * 4) }, simdi)).toBe(true);
  });

  it("eşik kuyruğun yeniden deneme penceresinden uzundur", () => {
    expect(HATA_YERLESME_MS).toBeGreaterThan(75_000);
  });

  it("hata dışındaki durumları hiç bulgu saymaz", () => {
    for (const durum of ["kuyrukta", "iletildi", "kabul", "ret", "iptal"]) {
      expect(yerlesmisHataMi({ durum, updatedAt: oncesi(HATA_YERLESME_MS * 10) }, simdi)).toBe(false);
    }
  });
});

describe("yerlesmisHataKosulu (EBLG-46)", () => {
  it("yalnız eşiği geçmiş hata kayıtlarını sorgular", () => {
    expect(yerlesmisHataKosulu(simdi)).toEqual({
      durum: "hata",
      updatedAt: { lte: new Date(simdi - HATA_YERLESME_MS) },
    });
  });

  it("koşul ile saf kural aynı kaydı seçer", () => {
    const sinir = yerlesmisHataKosulu(simdi).updatedAt as { lte: Date };
    expect(yerlesmisHataMi({ durum: "hata", updatedAt: sinir.lte }, simdi)).toBe(true);
    expect(yerlesmisHataMi({ durum: "hata", updatedAt: new Date(sinir.lte.getTime() + 1) }, simdi)).toBe(false);
  });
});
