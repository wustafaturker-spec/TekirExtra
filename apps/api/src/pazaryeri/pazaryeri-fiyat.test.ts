import { describe, expect, it } from "vitest";
import { faturaHesapla } from "@tekirextra/shared";
import { kdvDahilSatiriNetle, pazaryeriFaturaSatirlari } from "./pazaryeri-fiyat";

const toplam = (satirlar: ReturnType<typeof kdvDahilSatiriNetle>[]) =>
  faturaHesapla({ satirlar: satirlar.map((s) => ({ stokId: s.stokId, miktar: Number(s.miktar), birimFiyat: Number(s.birimFiyat), kdvOrani: Number(s.kdvOrani) })) }).genelToplam;

describe("PZR-01 KDV dahil pazaryeri fiyatı", () => {
  it("240 TL KDV dahil (%20) satır 200 + 40 olur, 288 değil", () => {
    const n = kdvDahilSatiriNetle({ stokId: "s", miktar: 2, kdvDahilBirimFiyat: 120, kdvOrani: 20 });
    expect(n).toEqual(expect.objectContaining({ birimFiyat: "100.0000", kdvDahilTutar: "240.00" }));
    expect(toplam([n])).toBe(240);
  });

  it("kuruşlu, tek sayılı miktar ve farklı oranlarda fatura toplamı ödenenden en çok 1 kuruş sapar; ulaşılabilen tutarda tam eşittir", () => {
    const ornekler: [number, number, number][] = [[3, 99.99, 20], [7, 13.37, 10], [1, 0.01, 20], [11, 4.99, 1], [13, 1234.57, 20], [150, 2.49, 20], [1, 498.9, 20], [5, 33.33, 0], [1, 99.99, 20]];
    for (const [miktar, fiyat, oran] of ornekler) {
      const n = kdvDahilSatiriNetle({ stokId: "s", miktar, kdvDahilBirimFiyat: fiyat, kdvOrani: oran });
      const odenen = Math.round(miktar * fiyat * 100) / 100;
      expect({ miktar, fiyat, oran, fark: Math.abs(Math.round((toplam([n]) - odenen) * 100)) }).toEqual({ miktar, fiyat, oran, fark: expect.any(Number) });
      expect(Math.abs(Math.round((toplam([n]) - odenen) * 100))).toBeLessThanOrEqual(1);
    }
    // Ulaşılabilen tutar tam eşit: 240 ve 498,90 (%20)
    expect(toplam([kdvDahilSatiriNetle({ stokId: "s", miktar: 1, kdvDahilBirimFiyat: 498.9, kdvOrani: 20 })])).toBe(498.9);
  });

  it("tolerans: 3 × 99,99 (%20) 1 kuruş farkla geçer ve fark döner", () => {
    const r = pazaryeriFaturaSatirlari([{ stokId: "a", miktar: 3, kdvDahilBirimFiyat: 99.99, kdvOrani: 20 }], 299.97);
    expect(Math.abs(Number(r.fark))).toBe(0.01);
  });

  it("tutar kilidi: sipariş toplamı tutarsa geçer, tutmazsa ya da yoksa hata", () => {
    const satirlar = [{ stokId: "a", miktar: 2, kdvDahilBirimFiyat: 120, kdvOrani: 20 }, { stokId: "b", miktar: 1, kdvDahilBirimFiyat: 55, kdvOrani: 10 }];
    expect(pazaryeriFaturaSatirlari(satirlar, 295)).toEqual(expect.objectContaining({ faturaToplami: "295.00", fark: "0.00" }));
    expect(() => pazaryeriFaturaSatirlari(satirlar, 354)).toThrow(/Tutar uyuşmuyor: fatura toplamı 295.00, pazaryeri sipariş toplamı 354.00/);
    expect(() => pazaryeriFaturaSatirlari(satirlar, 0)).toThrow(/sipariş toplamını bildirmedi/);
  });
});
