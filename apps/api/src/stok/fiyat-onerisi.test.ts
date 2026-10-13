import { describe, it, expect } from "vitest";
import { fiyatOnerisiHesapla } from "./fiyat-onerisi";

describe("Fiyat önerisi (AI-12)", () => {
  it("peşin satışta bayi indirimini doğru uygular", () => {
    const sonuc = fiyatOnerisiHesapla({
      stokId: "stk-1",
      bazFiyat: 100,
      paraBirimi: "TRY",
      maliyet: 60,
      vadeGun: 0,
      musteriGrubu: "Bayi",
    });

    expect(sonuc.kirilim.grupIskontosuYuzde).toBe(15);
    expect(sonuc.kirilim.efektifVadeGun).toBe(0);
    expect(sonuc.onerilenFiyat).toBe(85); // 100 * (1 - 0.15) = 85
    expect(sonuc.altSinirFiyat).toBeGreaterThanOrEqual(66); // 60 * 1.10 = 66
  });

  it("vadeli satışta aylık faiz maliyetini ve cari gecikmesini fiyata yansıtır", () => {
    const sonuc = fiyatOnerisiHesapla({
      stokId: "stk-1",
      bazFiyat: 100,
      paraBirimi: "TRY",
      maliyet: 60,
      vadeGun: 30, // 30 gün vade -> aylık %4.5 faiz
      cariOrtalamaGecikmeGun: 10, // +10 gün geçmiş gecikmesi -> 40 gün efektif
      musteriGrubu: "Perakende",
      aylikFinansmanOrani: 4.5,
    });

    expect(sonuc.kirilim.efektifVadeGun).toBe(40);
    // (4.5 / 30) * 40 = %6.0 finansman maliyeti
    expect(sonuc.kirilim.vadeFinansmanMaliyetiYuzde).toBe(6.0);
    expect(sonuc.onerilenFiyat).toBe(106.0);
    expect(sonuc.gerekceler.some((g) => g.includes("geçmiş ortalama 10 gün gecikmesi"))).toBe(true);
  });

  it("yüksek iskonto durumunda asgari maliyet kalkanı (Stop-Loss) devreye girer", () => {
    const sonuc = fiyatOnerisiHesapla({
      stokId: "stk-1",
      bazFiyat: 100,
      paraBirimi: "TRY",
      maliyet: 90, // Yüksek maliyet: Maliyet * 1.10 = 99 TL taban
      vadeGun: 0,
      musteriGrubu: "Bayi", // %15 iskonto ile 85 TL'ye düşmek ister
      miktar: 1500, // %5 ek hacim indirimi ile 80 TL'ye düşmek ister
    });

    // Taban fiyat maliyet + %10 marjdan (99 TL) aşağı inemez
    expect(sonuc.onerilenFiyat).toBe(99);
    expect(sonuc.gerekceler.some((g) => g.includes("tabanına çekildi"))).toBe(true);
  });

  it("maliyet bilinmiyorsa marj ve taban üretmez, varsayım yapmaz", () => {
    const sonuc = fiyatOnerisiHesapla({ stokId: "s", bazFiyat: 100, paraBirimi: "USD", maliyet: null, vadeGun: 0 });
    expect(sonuc.karMarjiYuzde).toBeNull();
    expect(sonuc.altSinirFiyat).toBeNull();
    expect(sonuc.kirilim.asgariMaliyetKalkan).toBeNull();
    expect(sonuc.uyarilar).toEqual([]);
    expect(sonuc.onerilenFiyat).toBe(100);
  });
});
