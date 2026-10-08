import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { miktarFarklari } from "./stok-tutarlilik";

const D = (v: number) => new Prisma.Decimal(v);

describe("stok tutarlılık farkları (STK-24)", () => {
  it("yalnız farklı anahtarları, eksik satırı sıfır sayarak döner", () => {
    const kayitli = new Map([["a", D(9)], ["b", D(5)], ["c", D(3)]]);
    const hareket = new Map([["a", D(21)], ["b", D(5)], ["d", D(-2)]]);
    expect(miktarFarklari(kayitli, hareket).map((f) => [f.anahtar, f.kayitli.toNumber(), f.hareket.toNumber(), f.fark.toNumber()])).toEqual([
      ["a", 9, 21, 12],
      ["c", 3, 0, -3],
      ["d", 0, -2, -2],
    ]);
  });
  it("ondalık eşitliği tam karşılaştırır", () => {
    expect(miktarFarklari(new Map([["a", D(1.5)]]), new Map([["a", new Prisma.Decimal("1.500")]]))).toEqual([]);
  });
});
