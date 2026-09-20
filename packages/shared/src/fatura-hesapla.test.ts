import { describe, expect, it } from "vitest";
import { faturaHesapla } from "./fatura-hesapla";

describe("faturaHesapla motoru (FTR-04/11)", () => {
  it("temel satır ve fatura toplamı hesaplar", () => {
    const girdi = {
      satirlar: [
        {
          stokId: "s1",
          miktar: 2,
          birimFiyat: 100, // 100 TL
          kdvOrani: 20,    // %20 KDV
        },
        {
          stokId: "s2",
          miktar: 10,
          birimFiyat: 15.5, // 15.5 TL
          kdvOrani: 10,    // %10 KDV
        },
      ],
    };

    const sonuc = faturaHesapla(girdi);

    expect(sonuc.toplamBrut).toBe(355.0); // 200 + 155
    expect(sonuc.toplamSatirIskontosu).toBe(0);
    expect(sonuc.toplamMatrah).toBe(355.0);
    expect(sonuc.toplamKdv).toBe(55.5); // (200 * 0.20) + (155 * 0.10) = 40 + 15.5 = 55.5
    expect(sonuc.genelToplam).toBe(410.5); // 355 + 55.5 = 410.5

    // KDV oranlarına göre kırılımı test et
    expect(sonuc.kdvDetaylari).toHaveLength(2);
    expect(sonuc.kdvDetaylari[0]).toEqual({
      kdvOrani: 20,
      matrah: 200.0,
      kdvTutari: 40.0,
      tevkifatTutari: 0,
    });
    expect(sonuc.kdvDetaylari[1]).toEqual({
      kdvOrani: 10,
      matrah: 155.0,
      kdvTutari: 15.5,
      tevkifatTutari: 0,
    });
  });

  it("satır iskontolarını hesaplar ve yuvarlar", () => {
    const girdi = {
      satirlar: [
        {
          stokId: "s1",
          miktar: 3,
          birimFiyat: 33.33, // 99.99 TL
          kdvOrani: 20,
          iskontoOrani: 10,  // %10 iskonto = 9.999 TL → 10.00 TL yuvarlanmış
        },
      ],
    };

    const sonuc = faturaHesapla(girdi);

    expect(sonuc.toplamBrut).toBe(99.99);
    expect(sonuc.toplamSatirIskontosu).toBe(10.00); // 9.999 -> 10.00
    expect(sonuc.toplamMatrah).toBe(89.99); // 99.99 - 10.00 = 89.99
    expect(sonuc.toplamKdv).toBe(18.00); // 89.99 * 20% = 17.998 -> 18.00
    expect(sonuc.genelToplam).toBe(107.99); // 89.99 + 18.00 = 107.99
  });

  it("genel iskontoyu orantısal dağıtır (pro-rata) ve kuruş farklarını giderir", () => {
    const girdi = {
      satirlar: [
        {
          stokId: "s1",
          miktar: 1,
          birimFiyat: 100, // 100 TL
          kdvOrani: 20,
        },
        {
          stokId: "s2",
          miktar: 1,
          birimFiyat: 200, // 200 TL
          kdvOrani: 20,
        },
      ],
      genelIskontoTutari: 10.00, // 10 TL genel iskonto
    };

    const sonuc = faturaHesapla(girdi);

    // Orantısal olarak:
    // Satır 1 (100 TL): 10 * (100 / 300) = 3.3333 -> 3.33 TL
    // Satır 2 (200 TL): 10 * (200 / 300) = 6.6666 -> 6.67 TL (son satır kalan yuvarlama farkını alır)
    expect(sonuc.satirlar[0].genelIskontoPayi).toBe(3.33);
    expect(sonuc.satirlar[1].genelIskontoPayi).toBe(6.67);
    expect(sonuc.toplamMatrah).toBe(290.00); // 300 - 10 = 290
  });

  it("tevkifatlı KDV hesaplarını yapar (FTR-11)", () => {
    const girdi = {
      satirlar: [
        {
          stokId: "s1",
          miktar: 1,
          birimFiyat: 1000,
          kdvOrani: 20,
          tevkifatPay: 5,     // 5/10 tevkifat
          tevkifatPayda: 10,
        },
      ],
    };

    const sonuc = faturaHesapla(girdi);

    expect(sonuc.toplamMatrah).toBe(1000.0);
    expect(sonuc.toplamKdv).toBe(200.0); // %20 KDV
    expect(sonuc.toplamTevkifat).toBe(100.0); // 200 * (5/10) = 100
    expect(sonuc.toplamNetKdv).toBe(100.0); // 200 - 100 = 100
    expect(sonuc.genelToplam).toBe(1100.0); // 1000 + 100 = 1100
  });
});

describe("ihraç kayıtlı satış — KDV tahsil edilmez (EBLG-60)", () => {
  it("KDV hesaplanır ama net KDV sıfır, genel toplam matrahtır", () => {
    // Örnek belge M012026000000078: 7000 × 15,665755 = 109.660,29 matrah, %10 KDV 10.966,03.
    const sonuc = faturaHesapla({ satirlar: [{ stokId: "s", miktar: 7000, birimFiyat: 15.665755, kdvOrani: 10 }], kdvTahsilEdilmez: true });
    expect(sonuc.toplamMatrah).toBe(109660.29);
    expect(sonuc.toplamKdv).toBe(10966.03);
    expect(sonuc.toplamNetKdv).toBe(0);
    expect(sonuc.genelToplam).toBe(109660.29);
  });
});

describe("faturaHesapla — özel matrah", () => {
  it("satır KDV'siz kalır, özel matrahın KDV'si genel toplama eklenir", () => {
    // Saha örneği: satır 95.465,35 (KDV hariç), matrah 3.465,35, %1 → 34,65.
    const sonuc = faturaHesapla({
      satirlar: [{ stokId: "s1", miktar: 1, birimFiyat: 95465.35, kdvOrani: 0 }],
      ozelMatrahKdvsi: 34.65,
    });
    expect(sonuc.toplamMatrah).toBe(95465.35);
    expect(sonuc.toplamKdv).toBe(34.65);
    expect(sonuc.toplamNetKdv).toBe(34.65);
    expect(sonuc.genelToplam).toBe(95500);
  });
});
