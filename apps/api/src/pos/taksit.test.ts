import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { saglayiciKesintiAlanlari, tahminiKomisyon, taksitTablosu } from "./taksit";

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
  it("KSB-37: komisyon = tahsilat − işyerine geçen; fazla geçerse 0; pay bilinmiyorsa tahmin korunur", () => {
    const g = saglayiciKesintiAlanlari(new Prisma.Decimal(1000), { isyerineGecenKalemleri: ["600.1", "364.75"], saglayiciKomisyonu: "34.9" });
    expect([g.isyerineGecen?.toFixed(2), g.komisyonTutari?.toFixed(2), g.netTutar?.toFixed(2), g.komisyonOrani?.toFixed(2), g.komisyonKaynagi]).toEqual(["964.85", "35.15", "964.85", "3.52", "saglayici"]);
    const fazla = saglayiciKesintiAlanlari(new Prisma.Decimal(1000), { isyerineGecenKalemleri: ["1015"] });
    expect([fazla.komisyonTutari?.toFixed(2), fazla.netTutar?.toFixed(2), fazla.isyerineGecen?.toFixed(2)]).toEqual(["0.00", "1000.00", "1015.00"]);
    const bilgi = saglayiciKesintiAlanlari(new Prisma.Decimal(1000), { kartSon4: "0008" });
    expect(bilgi).not.toHaveProperty("komisyonTutari");
    expect(bilgi.kartSon4).toBe("0008");
  });
});
