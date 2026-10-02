import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { faturaOdemeDurumu, kurFarkiTry, mahsupAyir } from "./odeme-durumu";

const D = (deger: string) => new Prisma.Decimal(deger);
const fatura = (genelToplam: string, kasa: Array<string | null>, kart: Array<string | null> = [], durum = "kesin") => ({
  durum,
  genelToplam: D(genelToplam),
  kasaBankaHarekets: kasa.map((m) => ({ faturaMahsubu: m === null ? null : D(m) })),
  krediKartiHareketleri: kart.map((m) => ({ faturaMahsubu: m === null ? null : D(m) })),
});

describe("faturaOdemeDurumu (KSB-07)", () => {
  it("kasa/banka ve kredi kartı mahsuplarını birlikte sayar", () => {
    const durum = faturaOdemeDurumu(fatura("1000", ["300"], ["200"]));
    expect(durum.odenen.toFixed(2)).toBe("500.00");
    expect(durum.kalan.toFixed(2)).toBe("500.00");
    expect(durum.durum).toBe("kismi");
  });

  it("mahsubu olmayan (faturaya bağlanmamış) hareketi saymaz", () => {
    expect(faturaOdemeDurumu(fatura("100", [null])).durum).toBe("odenmedi");
  });

  it("kalan eksiye düşmez, fazla ödenen eski kayıt 'ödendi' görünür", () => {
    const durum = faturaOdemeDurumu(fatura("100", ["150"]));
    expect(durum.kalan.toFixed(2)).toBe("0.00");
    expect(durum.odenen.toFixed(2)).toBe("150.00");
    expect(durum.durum).toBe("odendi");
  });

  it("kesinleşmemiş faturada durum 'beklemede'", () => {
    expect(faturaOdemeDurumu(fatura("100", [], [], "taslak")).durum).toBe("beklemede");
  });
});

describe("mahsupAyir", () => {
  it("kalanı aşan karşılığın artanını avans ayırır", () => {
    const { mahsup, avans } = mahsupAyir(D("450"), D("300"));
    expect([mahsup.toFixed(2), avans.toFixed(2)]).toEqual(["300.00", "150.00"]);
  });
});

describe("kurFarkiTry", () => {
  it("USD faturanın yüksek kurla tahsilinde artı kur farkı verir", () => {
    // 1.000 USD fatura kur 29,50; tahsil 30.000 TL → 500 TL kur farkı.
    expect(kurFarkiTry({ tutarTry: D("30000"), faturaKarsiligi: D("1000"), faturaMahsubu: D("1000") }, D("29.5"))).toBe("500.00");
  });

  it("avans kısmını kur farkına katmaz", () => {
    // 1.200 USD karşılık, 1.000 USD mahsup: TL'nin yalnız 1000/1200'ü faturaya düşer.
    expect(kurFarkiTry({ tutarTry: D("36000"), faturaKarsiligi: D("1200"), faturaMahsubu: D("1000") }, D("29.5"))).toBe("500.00");
  });

  it("TL faturada sıfırdır", () => {
    expect(kurFarkiTry({ tutarTry: D("500"), faturaKarsiligi: D("500"), faturaMahsubu: D("500") }, D("1"))).toBe("0.00");
  });
});
