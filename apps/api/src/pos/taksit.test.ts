import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { tahminiKomisyon, taksitTablosu } from "./taksit";

describe("KSB-35 taksit tablosu", () => {
  it("bozuk JSON satırlarını atlar", () => {
    expect(taksitTablosu(null)).toEqual([]);
    expect(taksitTablosu({ a: 1 } as never)).toEqual([]);
    expect(taksitTablosu([{ taksit: 3, oran: "3.49" }, { taksit: 1, oran: "2" }, { taksit: 6, oran: "abc" }, null])).toEqual([{ taksit: 3, oran: "3.49" }]);
  });
  it("taksit oranı ve işlem ücretiyle komisyon tahmin eder", () => {
    const hesap = { komisyonOrani: new Prisma.Decimal("1.99"), islemUcreti: new Prisma.Decimal("0.25"), taksitOranlari: [{ taksit: 3, oran: "3.49" }] };
    expect(tahminiKomisyon(new Prisma.Decimal("1000"), hesap).komisyon.toFixed(2)).toBe("20.15");
    const t3 = tahminiKomisyon(new Prisma.Decimal("1000"), hesap, 3);
    expect(t3.oran.toFixed(2)).toBe("3.49");
    expect(t3.komisyon.toFixed(2)).toBe("35.15");
    // Tabloda olmayan taksit tek çekim oranına düşer.
    expect(tahminiKomisyon(new Prisma.Decimal("1000"), hesap, 6).komisyon.toFixed(2)).toBe("20.15");
  });
});
