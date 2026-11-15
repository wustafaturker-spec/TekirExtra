import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const kurlar: Record<string, string | null> = { USD: "40.5", EUR: null };
vi.mock("../doviz/kur-coz", () => ({ kurCoz: vi.fn(async (_tx: unknown, _t: string, doviz: string, _tarih: Date, tip: string) => (tip === "satis" && kurlar[doviz] ? new Prisma.Decimal(kurlar[doviz]!) : null)) }));
const { kartAlisMaliyeti, partileriBirlestir, sayimSiniri } = await import("./sayim.service");

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

describe("stok yokken sayım farkının maliyeti (kartın alış fiyatı)", () => {
  const tx = {} as never, tarih = new Date("2026-10-17T00:00:00Z");
  it("TL fiyat olduğu gibi; boş ya da sıfır fiyat 0", async () => {
    expect((await kartAlisMaliyeti(tx, "t", { ad: "A", alisFiyati: new Prisma.Decimal("12.5"), alisFiyatiDoviz: "TRY" }, tarih)).toString()).toBe("12.5");
    expect((await kartAlisMaliyeti(tx, "t", { ad: "A", alisFiyati: null, alisFiyatiDoviz: "USD" }, tarih)).toString()).toBe("0");
  });
  it("dövizli fiyat sayım günü döviz satış kuruyla TL'ye çevrilir (0,25 USD × 40,5 = 10,125 TL)", async () => {
    expect((await kartAlisMaliyeti(tx, "t", { ad: "SF0101", alisFiyati: new Prisma.Decimal("0.25"), alisFiyatiDoviz: "USD" }, tarih)).toString()).toBe("10.125");
  });
  it("kur yoksa onay durur; yanlış maliyetle yazılmaz", async () => {
    await expect(kartAlisMaliyeti(tx, "t", { ad: "Ürün E", alisFiyati: new Prisma.Decimal("3"), alisFiyatiDoviz: "EUR" }, tarih)).rejects.toThrow(/EUR kuru gerekiyor/);
  });
});
