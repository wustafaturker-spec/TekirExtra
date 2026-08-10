import { describe, expect, it } from "vitest";
import { cariDavranisAnalizi } from "./cari-analiz";

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
});
