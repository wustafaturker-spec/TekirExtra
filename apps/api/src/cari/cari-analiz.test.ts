import { describe, expect, it } from "vitest";
import { cariDavranisAnalizi, gecikmeEgilimi } from "./cari-analiz";

const gun = (tarih: string) => new Date(`${tarih}T00:00:00.000Z`);

describe("cariDavranisAnalizi", () => {
  it("FIFO kapanan borclardan tutar agirlikli gecikmeyi hesaplar", () => {
    const sonuc = cariDavranisAnalizi([
      { tip: "borc", tutarTry: 1000, tarih: gun("2026-01-01"), vadeTarihi: gun("2026-01-10") },
      { tip: "alacak", tutarTry: 1000, tarih: gun("2026-01-20"), vadeTarihi: null },
      { tip: "borc", tutarTry: 500, tarih: gun("2026-02-01"), vadeTarihi: gun("2026-02-10") },
      { tip: "alacak", tutarTry: 500, tarih: gun("2026-02-10"), vadeTarihi: null },
    ], 5000, gun("2026-03-01"));

    expect(sonuc.tahminiGecikmeGun).toBe(7);
    expect(sonuc.metrikler.zamanindaOdemeOrani).toBe(33);
    expect(sonuc.odemeDavranisi).toBe("kismen_gec");
  });

  it("vadesi gecmis acik bakiyeyi risk skoruna yansitir", () => {
    const sonuc = cariDavranisAnalizi([
      { tip: "borc", tutarTry: 1000, tarih: gun("2026-01-01"), vadeTarihi: gun("2026-01-10") },
    ], 500, gun("2026-03-01"));

    expect(sonuc.metrikler.vadesiGecmisBakiye).toBe("1000.00");
    expect(sonuc.riskSeviyesi).toBe("yuksek");
    expect(sonuc.odemeDavranisi).toBe("veri_yetersiz");
  });

  it("CARI-44: gecikme eğilimi son 3 ayı önceki 6 ayla karşılaştırır", () => {
    const borcOde = (vade: string, odeme: string) => [
      { tip: "borc" as const, tutarTry: 100, tarih: gun(vade), vadeTarihi: gun(vade) },
      { tip: "alacak" as const, tutarTry: 100, tarih: gun(odeme), vadeTarihi: null },
    ];
    const egilim = gecikmeEgilimi([
      ...borcOde("2026-02-01", "2026-02-06"), // önceki pencere: 5 gün
      ...borcOde("2026-04-01", "2026-04-06"), // önceki pencere: 5 gün
      ...borcOde("2026-07-01", "2026-07-21"), // son 3 ay: 20 gün
      ...borcOde("2026-08-01", "2026-08-31"), // son 3 ay: 30 gün
    ], gun("2026-09-30"));
    expect(egilim).toEqual({ sonUcAy: 25, oncekiAltiAy: 5 });
  });

  it("CARI-44: penceresinde 2 kapanıştan az olan eğilim null döner", () => {
    const egilim = gecikmeEgilimi([
      { tip: "borc", tutarTry: 100, tarih: gun("2026-08-01"), vadeTarihi: gun("2026-08-01") },
      { tip: "alacak", tutarTry: 100, tarih: gun("2026-08-11"), vadeTarihi: null },
    ], gun("2026-09-30"));
    expect(egilim).toEqual({ sonUcAy: null, oncekiAltiAy: null });
  });
});
