import { describe, it, expect } from "vitest";
import { ayarTanimiAl } from "../core/ayarlar/ayar-kayit";
import "../ayar-tanimlari";
import { FIYAT_ONERISI_VARSAYILAN, fiyatOnerisiHesapla } from "./fiyat-onerisi";

const taban = { stokId: "s", bazFiyat: 100, paraBirimi: "TRY", maliyet: null, vadeGun: 0 };

describe("Fiyat önerisi ayarları (AI-21)", () => {
  it("firma ayarıyla grup iskontosunu uygular", () => {
    const s = fiyatOnerisiHesapla({ ...taban, musteriGrubu: "Bayi" }, { ...FIYAT_ONERISI_VARSAYILAN, bayiIskontoYuzde: 20 });
    expect(s.kirilim.grupIskontosuYuzde).toBe(20);
    expect(s.onerilenFiyat).toBe(80);
  });
  it("hacim eşiklerini ve finansman oranını ayardan alır", () => {
    const ayar = { ...FIYAT_ONERISI_VARSAYILAN, hacimEsik1: 10, hacimIskonto1Yuzde: 1, hacimEsik2: 50, hacimIskonto2Yuzde: 3, aylikFinansmanYuzde: 3 };
    expect(fiyatOnerisiHesapla({ ...taban, miktar: 10 }, ayar).kirilim.miktarIskontosuYuzde).toBe(1);
    const s = fiyatOnerisiHesapla({ ...taban, miktar: 50, vadeGun: 30 }, ayar);
    expect(s.kirilim.miktarIskontosuYuzde).toBe(3);
    expect(s.kirilim.vadeFinansmanMaliyetiYuzde).toBe(3);
    expect(s.gerekceler.join(" ")).toContain("50+ adetlik");
  });
  it("sıfır iskontoda gerekçe yazmaz", () => {
    const s = fiyatOnerisiHesapla({ ...taban, musteriGrubu: "Toptan" }, { ...FIYAT_ONERISI_VARSAYILAN, toptanIskontoYuzde: 0 });
    expect(s.onerilenFiyat).toBe(100);
    expect(s.gerekceler.join(" ")).not.toContain("Toptan");
  });
  it("varsayılan ayarlar bugünkü sabit değerlerdir ve geçerlidir", () => {
    const t = ayarTanimiAl("fiyat_onerisi")!;
    expect(t.varsayilanlar).toEqual({ bayiIskontoYuzde: 15, toptanIskontoYuzde: 10, vipIskontoYuzde: 8, hacimEsik1: 250, hacimIskonto1Yuzde: 2.5, hacimEsik2: 1000, hacimIskonto2Yuzde: 5, aylikFinansmanYuzde: 4.5 });
    expect(t.sema.safeParse(t.varsayilanlar).success).toBe(true);
  });
  it("ikinci eşik birinciden büyük olmalı, oranlar 0–100 aralığında kalmalı", () => {
    const t = ayarTanimiAl("fiyat_onerisi")!;
    expect(t.sema.safeParse({ ...t.varsayilanlar, hacimEsik1: 1000, hacimEsik2: 1000 }).success).toBe(false);
    expect(t.sema.safeParse({ ...t.varsayilanlar, bayiIskontoYuzde: 101 }).success).toBe(false);
    expect(t.sema.safeParse({ ...t.varsayilanlar, aylikFinansmanYuzde: -1 }).success).toBe(false);
  });
});

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
