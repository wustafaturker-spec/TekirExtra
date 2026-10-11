import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { satisKirilimi } from "./satis-kirilimi";

const D = (n: number) => new Prisma.Decimal(n);
const s = (faturaId: string, cariId: string, ciro: number, miktar = 1) => ({ faturaId, cariId, stokId: "s", ciro: D(ciro), miktar: D(miktar) });

describe("satış kırılımı (RPR-29)", () => {
  it("anahtara göre toplar, payı hesaplar, iade eksi düşer, atanmamış en sonda", () => {
    const temsilci: Record<string, string | null> = { c1: "Ayşe", c2: "Ali", c3: null };
    const r = satisKirilimi([s("f1", "c1", 600, 6), s("f2", "c1", -100, -1), s("f3", "c2", 300, 3), s("f4", "c3", 200, 2)], (x) => temsilci[x.cariId]);
    expect(r).toEqual([
      { grup: "Ayşe", netSatis: "500.00", pay: 50, faturaSayisi: 2, cariSayisi: 1, miktar: "5.000" },
      { grup: "Ali", netSatis: "300.00", pay: 30, faturaSayisi: 1, cariSayisi: 1, miktar: "3.000" },
      { grup: "Atanmamış", netSatis: "200.00", pay: 20, faturaSayisi: 1, cariSayisi: 1, miktar: "2.000" },
    ]);
  });

  it("boş girdi ve sıfır toplamda pay tanımsız", () => {
    expect(satisKirilimi([], () => "x")).toEqual([]);
    expect(satisKirilimi([s("f1", "c1", 0)], () => "x")[0].pay).toBeNull();
  });
});
