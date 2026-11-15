import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { aySonuDegeri, cizgiOlcekle } from "./fiyat-endeks-cizgiler";

const D = (v: string) => new Prisma.Decimal(v);
const at = (s: string) => new Date(s);

describe("END-07 ek çizgiler", () => {
  const degisimler = [
    { at: at("2026-03-10T09:00:00+03:00"), eski: D("100"), yeni: D("110") },
    { at: at("2026-05-31T23:30:00+03:00"), eski: D("110"), yeni: D("125") },
  ];
  it("ay sonu fiyatı: ilk değişiklikten önce eski fiyat, sonra son değişiklik; Türkiye saatiyle ay sınırı", () => {
    expect(aySonuDegeri(degisimler, "2026-02-01")?.toString()).toBe("100");
    expect(aySonuDegeri(degisimler, "2026-03-01")?.toString()).toBe("110");
    expect(aySonuDegeri(degisimler, "2026-04-01")?.toString()).toBe("110");
    // 31 Mayıs 23:30 (TR) Mayıs'a aittir; UTC'de de Mayıs ama 1 Haziran 01:00 TR olsaydı Haziran'a düşerdi.
    expect(aySonuDegeri(degisimler, "2026-05-01")?.toString()).toBe("125");
    expect(aySonuDegeri([{ at: at("2026-06-01T01:00:00+03:00"), eski: D("125"), yeni: D("130") }], "2026-05-01")?.toString()).toBe("125");
  });
  it("eski fiyatı olmayan ilk kayıttan önceki ay boştur", () => {
    expect(aySonuDegeri([{ at: at("2026-03-10T09:00:00+03:00"), eski: null, yeni: D("110") }], "2026-02-01")).toBeNull();
  });
  it("baz fiyata göre 100 ölçeği; baz yoksa yalnız TL", () => {
    const aylar = ["2026-01-01", "2026-02-01", "2026-03-01"];
    const f = new Map([["2026-01-01", D("80")], ["2026-03-01", D("120")]]);
    expect(cizgiOlcekle(aylar, f, D("100"))).toEqual([
      { ay: "2026-01-01", fiyat: "80.0000", normal: "80.00" },
      { ay: "2026-02-01", fiyat: null, normal: null },
      { ay: "2026-03-01", fiyat: "120.0000", normal: "120.00" },
    ]);
    expect(cizgiOlcekle(aylar, f, null)[0]).toEqual({ ay: "2026-01-01", fiyat: "80.0000", normal: null });
  });
});
