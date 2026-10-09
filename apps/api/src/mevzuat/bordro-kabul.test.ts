import { describe, expect, it } from "vitest";
import { mevzuatDegerHatalari } from "@tekirextra/shared";
import { kabulCalistir, kabulSenaryosuSemasi } from "./bordro-kabul";
import { bordroParametreleri } from "../personel/bordro-mevzuati";
import { ILK_DOLUM_KAYITLARI as kayitlar } from "../personel/bordro-ilk-dolum.test-veri";

const asgari = { girdiler: { brutUcret: 33030, primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 }, tolerans: 0.01 };

describe("bordro ilk dolumu (MVZ-14)", () => {
  it("iki kayıt var ve merkezin değer kuralından geçer", () => {
    expect(kayitlar).toHaveLength(2);
    for (const k of kayitlar) expect(mevzuatDegerHatalari("bordro_parametreleri", "genel", k)).toEqual([]);
  });

  for (const [i, k] of kayitlar.entries()) {
    it(`${i + 1}. kayıt: 2026 asgari ücret 33.030 brüt → 28.075,50 net, GV ve DV istisnalı`, () => {
      const s = kabulCalistir(k, { ...asgari, beklenen: { sgkIsci: 4624.2, issizlikIsci: 330.3, gelirVergisi: 0, damgaVergisi: 0, netUcret: 28075.5, isverenSgk: 7184.03, isverenIssizlik: 660.6 } });
      expect(s.basarili, JSON.stringify(s.alanlar)).toBe(true);
    });
    it(`${i + 1}. kayıt: imalat 5 puan teşvikle işveren maliyeti 39.223,13`, () => {
      const s = kabulCalistir(k, { ...asgari, girdiler: { ...asgari.girdiler, sgkTesvikOrani: 5 }, beklenen: { isverenSgkTesvikIndirimi: 1651.5, isverenMaliyeti: 39223.13 } });
      expect(s.basarili, JSON.stringify(s.alanlar)).toBe(true);
    });
  }

  it("yemek SGK istisnası: Ocak–Nisan 260,39 (%23,65), Mayıs'tan 300", () => {
    expect(bordroParametreleri(kayitlar[0]).yemekSgkGunlukIstisna).toBe(Math.round((33030 / 30) * 0.2365 * 100) / 100);
    expect(bordroParametreleri(kayitlar[1]).yemekSgkGunlukIstisna).toBe(300);
    expect(bordroParametreleri(kayitlar[0]).engellilikIndirimi).toEqual({ derece1: 12000, derece2: 7000, derece3: 3000 });
  });

  it("tutmayan beklenen değer senaryoyu başarısız yapar, fark raporlanır", () => {
    const s = kabulCalistir(kayitlar[1], { ...asgari, beklenen: { netUcret: 28000 } });
    expect(s.basarili).toBe(false);
    expect(s.alanlar.netUcret).toEqual({ beklenen: 28000, hesaplanan: 28075.5, fark: 75.5 });
  });

  it("senaryo şeması bilinmeyen sonuç alanını ve boş beklentiyi reddeder", () => {
    expect(kabulSenaryosuSemasi.safeParse({ ad: "Asgari", girdiler: asgari.girdiler, beklenen: { netMaas: 1 } }).success).toBe(false);
    expect(kabulSenaryosuSemasi.safeParse({ ad: "Asgari", girdiler: asgari.girdiler, beklenen: {} }).success).toBe(false);
    expect(kabulSenaryosuSemasi.safeParse({ ad: "Asgari", girdiler: asgari.girdiler, beklenen: { netUcret: 28075.5 } }).success).toBe(true);
  });
});

describe("bordro parametresi değer kuralı", () => {
  const temel = kayitlar[1]!;
  it("son dilimi sınırlı, sırasız dilim ve %100 üstü oran reddedilir", () => {
    expect(mevzuatDegerHatalari("bordro_parametreleri", "genel", { ...temel, gelirVergisiDilimleri: [{ ustSinir: 190000, oran: 15 }] }).join()).toMatch(/sınırsız/);
    expect(mevzuatDegerHatalari("bordro_parametreleri", "genel", { ...temel, gelirVergisiDilimleri: [{ ustSinir: 400000, oran: 15 }, { ustSinir: 190000, oran: 20 }, { ustSinir: null, oran: 40 }] }).join()).toMatch(/artan/);
    expect(mevzuatDegerHatalari("bordro_parametreleri", "genel", { ...temel, sgkIsciOrani: 140 }).join()).toMatch(/en çok 100/);
    expect(mevzuatDegerHatalari("bordro_parametreleri", "genel", { ...temel, sgkTavan: 1000 }).join()).toMatch(/tavanı/);
    expect(mevzuatDegerHatalari("bordro_parametreleri", "diger", temel).length).toBeGreaterThan(0);
  });
});
