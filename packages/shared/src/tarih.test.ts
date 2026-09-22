import { describe, expect, it } from "vitest";
import { anTR, ayBasiTR, ayTR, gunEkleTR, gunTR, yilBasiTR } from "./tarih";

describe("tarih — Türkiye takvimi", () => {
  it("UTC'de dün olan an Türkiye'de bugündür", () => {
    // 2026-09-20 00:30 (TRT) = 2026-09-19 21:30 UTC; toISOString "19" derdi.
    const gecenin_yarisi = new Date("2026-09-19T21:30:00Z");
    expect(gunTR(gecenin_yarisi)).toBe("2026-09-20");
    expect(ayTR(gecenin_yarisi)).toBe("2026-09");
    expect(ayBasiTR(gecenin_yarisi)).toBe("2026-09-01");
    expect(yilBasiTR(gecenin_yarisi)).toBe("2026-01-01");
  });

  it("gün ekler ve çıkarır", () => {
    const an = new Date("2026-09-19T21:30:00Z"); // TR: 2026-09-20
    expect(gunEkleTR(1, an)).toBe("2026-09-21");
    expect(gunEkleTR(-30, an)).toBe("2026-08-21");
    expect(gunEkleTR(0, an)).toBe("2026-09-20");
  });

  it("ay ve yıl sınırını doğru geçer", () => {
    expect(gunEkleTR(1, new Date("2026-12-31T21:30:00Z"))).toBe("2027-01-02");
  });
});

describe("anTR — UBL'e yazılan yerel tarih ve saat", () => {
  it("saati Türkiye saatiyle yazar, UTC ile değil", () => {
    expect(anTR(new Date("2026-09-22T09:30:00+03:00"))).toEqual({ tarih: "2026-09-22", saat: "09:30:00" });
  });

  it("gece yarısından sonraki sevkin günü geri kaymaz", () => {
    expect(anTR(new Date("2026-09-22T01:15:00+03:00"))).toEqual({ tarih: "2026-09-22", saat: "01:15:00" });
  });
});
