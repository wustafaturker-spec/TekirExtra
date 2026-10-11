import { describe, expect, it } from "vitest";
import { donemCoz, sonrakiGonderim, yenidenDenemeAni } from "./rapor-abonelik-zaman";

// 2026-10-11 Pazar 18:00 Türkiye = 15:00 UTC.
const SIMDI = new Date("2026-10-11T15:00:00Z");

describe("rapor aboneliği zamanı (RPR-24)", () => {
  it("günlük: saat geçmişse ertesi gün, geçmemişse bugün (Türkiye saati)", () => {
    expect(sonrakiGonderim({ siklik: "gunluk", gun: null, saat: "08:00" }, SIMDI).toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(sonrakiGonderim({ siklik: "gunluk", gun: null, saat: "19:30" }, SIMDI).toISOString()).toBe("2026-10-11T16:30:00.000Z");
  });

  it("haftalık Pazartesi 08:00 ve gece yarısı sınırı", () => {
    expect(sonrakiGonderim({ siklik: "haftalik", gun: 1, saat: "08:00" }, SIMDI).toISOString()).toBe("2026-10-12T05:00:00.000Z");
    // Pazar 01:00 TR = Cumartesi 22:00 UTC; "Pazar" Türkiye gününe göre.
    expect(sonrakiGonderim({ siklik: "haftalik", gun: 7, saat: "01:00" }, new Date("2026-10-10T12:00:00Z")).toISOString()).toBe("2026-10-10T22:00:00.000Z");
  });

  it("aylık: ayın 1'i, ay ve yıl geçişi", () => {
    expect(sonrakiGonderim({ siklik: "aylik", gun: 1, saat: "09:00" }, SIMDI).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(sonrakiGonderim({ siklik: "aylik", gun: 5, saat: "09:00" }, new Date("2026-12-20T10:00:00Z")).toISOString()).toBe("2027-01-05T06:00:00.000Z");
  });

  it("göreli dönemler Türkiye takvimine göre", () => {
    expect(donemCoz("dun", SIMDI)).toEqual({ baslangic: "2026-10-10", bitis: "2026-10-10" });
    expect(donemCoz("gecen_hafta", SIMDI)).toEqual({ baslangic: "2026-09-28", bitis: "2026-10-04" });
    expect(donemCoz("gecen_ay", SIMDI)).toEqual({ baslangic: "2026-09-01", bitis: "2026-09-30" });
    expect(donemCoz("bu_ay", SIMDI)).toEqual({ baslangic: "2026-10-01", bitis: "2026-10-11" });
    expect(donemCoz("bu_yil", SIMDI)).toEqual({ baslangic: "2026-01-01", bitis: "2026-10-11" });
    expect(donemCoz("gorunum", SIMDI)).toBeNull();
    // 1 Ocak 01:00 TR (31 Aralık UTC): "dün" 31 Aralık, geçen ay Aralık.
    const yilbasi = new Date("2026-12-31T22:00:00Z");
    expect(donemCoz("dun", yilbasi)).toEqual({ baslangic: "2026-12-31", bitis: "2026-12-31" });
    expect(donemCoz("gecen_ay", yilbasi)).toEqual({ baslangic: "2026-12-01", bitis: "2026-12-31" });
  });

  it("yeniden deneme 15 dk, 1 sa, 4 sa; sonra yok", () => {
    expect(yenidenDenemeAni(1, SIMDI)?.toISOString()).toBe("2026-10-11T15:15:00.000Z");
    expect(yenidenDenemeAni(3, SIMDI)?.toISOString()).toBe("2026-10-11T19:00:00.000Z");
    expect(yenidenDenemeAni(4, SIMDI)).toBeNull();
  });
});
