import { describe, expect, it } from "vitest";
import { abonelikDogrula, abonelikGirdisi, gonderimMetni } from "./rapor-abonelik.service";

const donemli = { filtreler: [{ alan: "baslangic", ad: "B", tip: "tarih" as const }, { alan: "bitis", ad: "B", tip: "tarih" as const }, { alan: "cari", ad: "Cari", tip: "cari" as const }] };
const SIMDI = new Date("2026-10-11T15:00:00Z");

describe("rapor aboneliği (RPR-24)", () => {
  it("göreli dönem görünümün sabit dönemini ezer, diğer süzgeçler kalır", () => {
    const g = abonelikGirdisi(donemli, { filtreler: { baslangic: "2025-01-01", bitis: "2025-01-31", cari: "c1" }, gruplama: "ay" }, "gecen_ay", SIMDI);
    expect(g).toEqual({ filtreler: { baslangic: "2026-09-01", bitis: "2026-09-30", cari: "c1" }, gruplama: "ay" });
  });

  it("'görünümdeki dönem' ve dönemsiz rapor girdiyi değiştirmez", () => {
    const girdi = { filtreler: { baslangic: "2025-01-01", bitis: "2025-01-31" } };
    expect(abonelikGirdisi(donemli, girdi, "gorunum", SIMDI)).toBe(girdi);
    expect(abonelikGirdisi({ filtreler: [] }, { filtreler: { tarih: "2026-01-01" } }, "dun", SIMDI)).toEqual({ filtreler: { tarih: "2026-01-01" } });
  });

  it("sıklık–gün ve saat doğrulaması", () => {
    expect(abonelikDogrula({ siklik: "gunluk", gun: null, saat: "08:00" })).toBeNull();
    expect(abonelikDogrula({ siklik: "gunluk", gun: null, saat: "8:00" })).toMatch(/Saat/);
    expect(abonelikDogrula({ siklik: "haftalik", gun: 8, saat: "08:00" })).toMatch(/Haftalık/);
    expect(abonelikDogrula({ siklik: "aylik", gun: 31, saat: "08:00" })).toMatch(/28/);
  });

  it("gövde: dönem, satır sayısı ve yalnız tek dövizli toplamlar", () => {
    const metin = gonderimMetni(
      { ad: "Tahsilat/Ödeme Özeti", kolonlar: [{ alan: "giris", baslik: "Giriş", tip: "para" }, { alan: "girisTry", baslik: "Giriş (TL)", tip: "para" }, { alan: "adet", baslik: "Fiş", tip: "sayi" }] },
      ["Geçen ay", "Dönem: 01.09.2026 – 30.09.2026"], 12,
      new Map([["giris", "karisik" as const], ["girisTry", { deger: 1234.5 }], ["adet", { deger: 12 }]]), "Aylık kasa",
    );
    expect(metin).toContain("Tahsilat/Ödeme Özeti — Aylık kasa");
    expect(metin).toContain("Dönem: 01.09.2026 – 30.09.2026");
    expect(metin).toContain("12 satır.");
    expect(metin).toContain("Giriş (TL): 1.234,50 TL");
    expect(metin).not.toContain("Giriş: ");
    expect(gonderimMetni({ ad: "X", kolonlar: [] }, [], 0, null, "G")).toContain("Bu dönemde kayıt yok.");
  });
});
