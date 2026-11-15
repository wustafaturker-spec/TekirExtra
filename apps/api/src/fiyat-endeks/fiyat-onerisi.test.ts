import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { bazAyi, oneriHesapla, yuvarla } from "./fiyat-onerisi";

const D = (v: string) => new Prisma.Decimal(v);
const endeks = new Map([["2026-01-01", D("100")], ["2026-06-01", D("112.5")]]);

describe("END-16 fiyat güncelleme önerisi", () => {
  it("son değişiklikten bu yana endeks oranı; yuvarlama kuralları", () => {
    expect(oneriHesapla(D("99.99"), "2026-01-01", "2026-06-01", endeks, "kurus")).toMatchObject({ durum: "oneri", endeksDegisim: "12.50", yeniFiyat: "112.4900", fark: "12.5000" });
    expect(oneriHesapla(D("99.99"), "2026-01-01", "2026-06-01", endeks, "tam").yeniFiyat).toBe("112.0000");
    expect(oneriHesapla(D("99.99"), "2026-01-01", "2026-06-01", endeks, "bes").yeniFiyat).toBe("110.0000");
    expect(oneriHesapla(D("99.99"), "2026-01-01", "2026-06-01", endeks, "on").yeniFiyat).toBe("110.0000");
    expect(yuvarla(D("2"), "on").toString()).toBe("10");
    expect(yuvarla(D("12.345"), "kurus").toFixed(2)).toBe("12.35");
  });
  it("geçmiş yoksa baz istenir; yeni endeks yoksa değişim yok; eksik değer belirtilir", () => {
    expect(oneriHesapla(D("10"), null, "2026-06-01", endeks, "kurus").durum).toBe("baz_yok");
    expect(oneriHesapla(D("10"), "2026-06-01", "2026-06-01", endeks, "kurus").durum).toBe("degisim_yok");
    expect(oneriHesapla(D("10"), "2026-02-01", "2026-06-01", endeks, "kurus")).toMatchObject({ durum: "endeks_yok", neden: "2026-02 için endeks değeri yok." });
  });
  it("baz ay değişikliğin Türkiye saatine göre ayından bir önceki aydır", () => {
    expect(bazAyi(new Date("2026-03-10T09:00:00+03:00"))).toBe("2026-02-01");
    expect(bazAyi(new Date("2026-03-31T22:30:00Z"))).toBe("2026-03-01"); // TR'de 1 Nisan 01:30
  });
});
