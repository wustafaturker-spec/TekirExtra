import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { varyantKirilimi } from "./stok.raporlar";

const D = (n: number) => new Prisma.Decimal(n);
const satir = { kod: "TS", ad: "Tişört", depo: "Tüm depolar", birim: "adet", miktar: 10, rezerve: 2, kullanilabilir: 8, yoldaki: 0, ortalamaMaliyet: "50.00", envanterDegeri: "500.00", stokId: "s1" };
const v = (kod: string, miktar: number, rezerve = 0) => ({ varyantId: kod, kod, ad: kod.toUpperCase(), miktar: D(miktar), rezerve: D(rezerve), yoldaki: D(0) });

describe("envanter varyant kırılımı (RPR-22)", () => {
  it("varyantlı kart varyant satırlarına bölünür; kalan varyantsız satır olur, sıfır varyant yazılmaz", () => {
    const r = varyantKirilimi([satir], new Map([["s1", [v("s", 4, 2), v("m", 5), v("l", 0)]]]));
    expect(r.map((x) => [x.kod, x.ad, x.miktar, x.kullanilabilir, x.envanterDegeri])).toEqual([
      ["TS / s", "Tişört — S", 4, 2, "200.00"],
      ["TS / m", "Tişört — M", 5, 5, "250.00"],
      ["TS", "Tişört — varyantsız", 1, 1, "50.00"],
    ]);
    expect(r.every((x) => !("stokId" in x))).toBe(true);
  });

  it("varyantsız kart olduğu gibi kalır; eksi varyant değerlenmez", () => {
    expect(varyantKirilimi([{ ...satir, stokId: "s2" }], new Map())[0].ad).toBe("Tişört");
    const r = varyantKirilimi([{ ...satir, miktar: -3 }], new Map([["s1", [v("s", -3)]]]));
    expect(r[0].envanterDegeri).toBeNull();
  });
});
