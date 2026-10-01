import { describe, expect, it } from "vitest";
import { isMerkeziKaydetSemasi, kaliteKararSemasi, uretimBildirimiSemasi, uretimEmriListeSemasi, uretimTamamlaSemasi } from "./uretim.semalar";

describe("uretimTamamlaSemasi", () => {
  it("çoklu ve benzersiz seri numaralarını kabul eder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNumaralari: ["SR-001", "SR-002"] });
    expect(sonuc.success).toBe(true);
  });

  it("yinelenen seri numaralarını reddeder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNumaralari: ["SR-001", "SR-001"] });
    expect(sonuc.success).toBe(false);
  });

  it("eski tek seri alanıyla çoklu alan arasındaki tekrarı reddeder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNo: "SR-001", seriNumaralari: ["SR-001"] });
    expect(sonuc.success).toBe(false);
  });
});

describe("isMerkeziKaydetSemasi", () => {
  it("iş merkezi kodunu normalize eder ve kapasite sınırlarını doğrular", () => {
    const sonuc = isMerkeziKaydetSemasi.safeParse({ kod: "  kesim ", ad: "Kesim Hattı", gunlukKapasiteDakika: "480", verimlilikYuzdesi: "85", saatlikMaliyet: "250", aktif: true });
    expect(sonuc.success && sonuc.data.kod).toBe("KESIM");
  });
});

describe("kaliteKararSemasi", () => {
  it("gerekçeli kabul veya red kararı ister", () => {
    expect(kaliteKararSemasi.safeParse({ karar: "kabul", kontrolNotu: "Ölçümler uygun", olcumler: { cap: 19.98 } }).success).toBe(true);
    expect(kaliteKararSemasi.safeParse({ karar: "red", kontrolNotu: "x" }).success).toBe(false);
  });
});

describe("uretimBildirimiSemasi", () => {
  it("kısmi miktar ve gerçek sarf satırlarını kabul eder", () => {
    const sonuc = uretimBildirimiSemasi.safeParse({
      idempotencyAnahtari: "11111111-1111-4111-8111-111111111111",
      uretilenMiktar: "4.5",
      hurdaMiktari: "0.2",
      hurdaNedeni: "Kesim toleransı dışında",
      sarflar: [{ uretimEmriKalemId: "22222222-2222-4222-8222-222222222222", miktar: "9.1" }],
    });
    expect(sonuc.success).toBe(true);
  });

  it("sıfır üretim miktarını reddeder", () => {
    const sonuc = uretimBildirimiSemasi.safeParse({ idempotencyAnahtari: "11111111-1111-4111-8111-111111111111", uretilenMiktar: "0" });
    expect(sonuc.success).toBe(false);
  });

  it("hurda veya yeniden işleme varsa neden ister", () => {
    const temel = { idempotencyAnahtari: "11111111-1111-4111-8111-111111111111", uretilenMiktar: "2" };
    expect(uretimBildirimiSemasi.safeParse({ ...temel, hurdaMiktari: "1" }).success).toBe(false);
    expect(uretimBildirimiSemasi.safeParse({ ...temel, yenidenIslemeMiktari: "1", yenidenIslemeNedeni: "Yüzey düzeltme" }).success).toBe(true);
  });
});

describe("uretimEmriListeSemasi", () => {
  it("desteklenen filtreleri kabul edip geçersiz durumu reddeder", () => {
    expect(uretimEmriListeSemasi.safeParse({ durum: "uretimde", arama: "URT-2026", geciken: "true" }).success).toBe(true);
    expect(uretimEmriListeSemasi.safeParse({ durum: "bilinmeyen" }).success).toBe(false);
  });
});

describe("iş merkezi saatlik maliyet kırılımı", () => {
  it("işçilik, makine ve genel gider ayrı alınır", () => {
    const sonuc = isMerkeziKaydetSemasi.parse({ kod: "m", ad: "Montaj", iscilikSaatlik: "300", makineSaatlik: "100", genelGiderSaatlik: "50" });
    expect([sonuc.iscilikSaatlik, sonuc.makineSaatlik, sonuc.genelGiderSaatlik]).toEqual([300, 100, 50]);
  });
  it("yalnız toplam gönderen eski istemcide toplam işçilik sayılır", () => {
    const sonuc = isMerkeziKaydetSemasi.parse({ kod: "m", ad: "Montaj", saatlikMaliyet: "250" });
    expect([sonuc.iscilikSaatlik, sonuc.makineSaatlik, sonuc.genelGiderSaatlik]).toEqual([250, 0, 0]);
  });
});
