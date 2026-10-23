import { describe, expect, it } from "vitest";
import { binekKkeg, gecerliYukumlulukler, kategoriOner, plakaGeciyor, sonrakiBakim, tuketim, yukumlulukDurumu } from "./arac-hesap";

describe("binek gider kısıtı (ARC-06)", () => {
  it("kira dışı giderin %30'u, kira bedelinin aylık sınırı aşan kısmı KKEG", () => {
    const s = binekKkeg([
      { kategori: "akaryakit", tarih: "2026-03-05", tutarTry: 6000 },
      { kategori: "bakim", tarih: "2026-03-20", tutarTry: 4000 },
      { kategori: "kira", tarih: "2026-03-01", tutarTry: 50000 },
      { kategori: "kira", tarih: "2026-04-01", tutarTry: 40000 },
    ], 70, (y) => (y === 2026 ? 46000 : null));
    expect([s.kiraDisiGider, s.kiraDisiKkeg, s.kiraKkeg, s.toplamKkeg]).toEqual([10000, 3000, 4000, 7000]);
    expect(s.aylar.map((a) => [a.ay, a.kkeg])).toEqual([["2026-03", 4000], ["2026-04", 0]]);
  });

  it("yılın kira sınırı yoksa o ayların KKEG'i hesaplanmaz ve yıl bildirilir", () => {
    const s = binekKkeg([{ kategori: "kira", tarih: "2027-01-01", tutarTry: 60000 }], 70, () => null);
    expect([s.kiraKkeg, s.sinirEksikYillar]).toEqual([0, [2027]]);
  });
});

describe("tüketim, bakım, yükümlülük (ARC-04/07/08)", () => {
  it("ilk alımın litresi sayılmadan 100 km başına tüketim", () => {
    expect(tuketim([{ km: 10000, litre: 40 }, { km: 10600, litre: 42 }, { km: 11200, litre: 36 }, { km: null, litre: 30 }])).toBe(6.5);
    expect(tuketim([{ km: 10000, litre: 40 }])).toBeNull();
  });

  it("sıradaki bakım hangisi önce gelirse; geciken ve yaklaşan", () => {
    const b = sonrakiBakim({ kmAraligi: 15000, ayAraligi: 12, sonTarih: "2025-11-15", sonKm: 30000, guncelKm: 44500, bugun: "2026-10-23" });
    expect(b).toMatchObject({ tarih: "2026-11-15", km: 45000, kalanGun: 23, kalanKm: 500, gecikti: false, yaklasiyor: true });
    expect(sonrakiBakim({ kmAraligi: 10000, ayAraligi: null, sonTarih: null, sonKm: 30000, guncelKm: 40500, bugun: "2026-10-23" })?.gecikti).toBe(true);
    expect(sonrakiBakim({ kmAraligi: null, ayAraligi: 12, sonTarih: "2026-01-31", sonKm: null, guncelKm: null, bugun: "2026-10-23" })?.tarih).toBe("2027-01-31");
    expect(sonrakiBakim({ kmAraligi: 10000, ayAraligi: null, sonTarih: null, sonKm: null, guncelKm: 5000, bugun: "2026-10-23" })).toBeNull();
  });

  it("30 ve 7 gün eşikleri, geçince doldu; türün en ileri bitişli kaydı geçerli", () => {
    expect(yukumlulukDurumu("2026-11-20", "2026-10-23").esik).toBe("30");
    expect(yukumlulukDurumu("2026-10-29", "2026-10-23").esik).toBe("7");
    expect(yukumlulukDurumu("2026-10-22", "2026-10-23").esik).toBe("doldu");
    expect(yukumlulukDurumu("2027-01-01", "2026-10-23").esik).toBeNull();
    const g = gecerliYukumlulukler([{ tur: "kasko", bitis: "2025-05-01" }, { tur: "kasko", bitis: "2026-05-01" }, { tur: "muayene", bitis: "2026-02-01" }]);
    expect(g.map((x) => `${x.tur}:${x.bitis}`)).toEqual(["muayene:2026-02-01", "kasko:2026-05-01"]);
  });

  it("kategori önerisi ve plaka eşleşmesi", () => {
    expect(kategoriOner("OPET MOTORİN 45 LT")).toBe("akaryakit");
    expect(kategoriOner("Osmangazi Köprüsü geçiş")).toBe("hgs");
    expect(kategoriOner("Periyodik bakım ve yağ değişimi")).toBe("bakim");
    expect(plakaGeciyor("Yakıt 34abc123 aracı", "34 ABC 123")).toBe(true);
  });
});
