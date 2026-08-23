import { describe, expect, it } from "vitest";
import { sgkDevirleriniDonemeTasi, sgkMatrahDevriniHesapla } from "./sgk-matrah-devri";

describe("SGK ücret dışı ödeme matrah devri", () => {
  it("tavanı aşan prim ve ikramiyeyi iki ay süreli devreder", () => {
    const sonuc = sgkMatrahDevriniHesapla({
      ucretPrimeEsasKazanc: 100_000,
      ucretDisiOdeme: 300_000,
      sgkTavan: 225_000,
    });
    expect(sonuc.primeEsasKazanc).toBe("225000.00");
    expect(sonuc.cariAyUcretDisiUygulanan).toBe("125000.00");
    expect(sonuc.cariAyDevreden).toBe("175000.00");
    expect(sonuc.sonrakiDonemDevirleri).toEqual([{ tutar: "175000.00", kalanAy: 2 }]);
  });

  it("eski devri önce tüketip kalan ömrünü bir ay azaltır", () => {
    const sonuc = sgkMatrahDevriniHesapla({
      ucretPrimeEsasKazanc: 150_000,
      ucretDisiOdeme: 25_000,
      sgkTavan: 225_000,
      devredenler: [{ tutar: 100_000, kalanAy: 2 }],
    });
    expect(sonuc.devredenUygulanan).toBe("75000.00");
    expect(sonuc.cariAyUcretDisiUygulanan).toBe("0.00");
    expect(sonuc.sonrakiDonemDevirleri).toEqual([
      { tutar: "25000.00", kalanAy: 1 },
      { tutar: "25000.00", kalanAy: 2 },
    ]);
  });

  it("ikinci takip ayından sonra kullanılamayan eski devri düşürür", () => {
    const sonuc = sgkMatrahDevriniHesapla({
      ucretPrimeEsasKazanc: 225_000,
      ucretDisiOdeme: 0,
      sgkTavan: 225_000,
      devredenler: [{ tutar: 40_000, kalanAy: 1 }],
    });
    expect(sonuc.devredenUygulanan).toBe("0.00");
    expect(sonuc.sonrakiDonemDevirleri).toEqual([]);
  });

  it("ücretin tavanı aşan kısmını devretmez", () => {
    const sonuc = sgkMatrahDevriniHesapla({
      ucretPrimeEsasKazanc: 300_000,
      ucretDisiOdeme: 0,
      sgkTavan: 225_000,
    });
    expect(sonuc.primeEsasKazanc).toBe("225000.00");
    expect(sonuc.sonrakiDonemDevirleri).toEqual([]);
  });
});

describe("SGK matrah devrinin dönem yaşı", () => {
  const devirler = [{ tutar: "40000.00", kalanAy: 2 as const }];
  it("hemen izleyen aya kalan süreyi değiştirmeden taşır", () => {
    expect(sgkDevirleriniDonemeTasi(devirler, 2026, 1, 2026, 2)).toEqual(devirler);
  });
  it("bir ay atlandığında yalnız son kullanım ayına taşır", () => {
    expect(sgkDevirleriniDonemeTasi(devirler, 2026, 1, 2026, 3)).toEqual([{ tutar: "40000.00", kalanAy: 1 }]);
  });
  it("iki ay atlandığında ve yıl geçişinde devri düşürür", () => {
    expect(sgkDevirleriniDonemeTasi(devirler, 2026, 11, 2027, 2)).toEqual([]);
  });
});
