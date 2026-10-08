import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { partileriBirlestir, sayimSiniri } from "./sayim.service";

describe("sayım (STK-29…31)", () => {
  it("sayım tarihinin gün sonu sınır; ay ve yıl taşar", () => {
    expect(sayimSiniri("2026-10-08").toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(sayimSiniri(new Date("2026-12-31T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("sayılmayan sistem partisi fiili 0, yeni lot sistem 0 olarak birleşir", () => {
    const sonuc = partileriBirlestir(
      [{ lotNo: "L1", fiiliMiktar: "8" }, { lotNo: "L3", sonKullanmaTarihi: "2027-01-01", fiiliMiktar: "4" }],
      [{ lotNo: "L1", seriNo: null, sonKullanmaTarihi: "2026-12-01", miktar: new Prisma.Decimal(10) }, { lotNo: "L2", seriNo: null, sonKullanmaTarihi: null, miktar: new Prisma.Decimal(5) }],
    );
    expect(sonuc.map((p) => [p.lotNo, p.sistemMiktar, p.fiiliMiktar, p.sonKullanmaTarihi])).toEqual([
      ["L1", "10.000", "8.000", "2026-12-01"],
      ["L2", "5.000", "0.000", null],
      ["L3", "0.000", "4.000", "2027-01-01"],
    ]);
  });
});
