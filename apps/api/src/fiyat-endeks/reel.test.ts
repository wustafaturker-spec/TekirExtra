import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { reelDegerleyici } from "./reel";

const D = (v: string) => new Prisma.Decimal(v);
describe("END-18 reel değerleyici", () => {
  const degerler = new Map([["2026-01-01", D("100")], ["2026-06-01", D("125")]]);
  it("baz = bitiş ayına kadar son açıklanan ay; tutarın ayı yoksa önceki son değer", () => {
    const r = reelDegerleyici(degerler, "2026-09-01")!;
    expect(r.bazAy).toBe("2026-06-01");
    expect(r.carpan("2026-01-20")!.toFixed(4)).toBe("1.2500");
    expect(r.carpan(new Date("2026-03-15T12:00:00Z"))!.toFixed(4)).toBe("1.2500"); // Mart yok → Ocak
    expect(r.carpan("2026-07-02")!.toFixed(4)).toBe("1.0000");
    expect(r.carpan("2025-12-01")).toBeNull();
  });
  it("bitişten önce hiç değer yoksa değerleyici yok", () => {
    expect(reelDegerleyici(degerler, "2025-06-01")).toBeNull();
  });
});
