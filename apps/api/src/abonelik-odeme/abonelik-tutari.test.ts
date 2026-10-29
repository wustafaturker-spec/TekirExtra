import { describe, expect, it } from "vitest";
import { abonelikTutari } from "./abonelik-tutari";
import { baglantiAnahtariDogrula, baglantiAnahtariUret } from "./baglanti-anahtari";
import { adSoyadAyir } from "./abonelik-odeme.service";

describe("abonelik tutarı (PLT-12)", () => {
  it("katalog fiyatı KDV hariçtir; %20 KDV eklenir ve süreyle çarpılır", () => {
    const t = abonelikTutari("baslangic", 1)!;
    expect([t.matrah.toFixed(2), t.kdv.toFixed(2), t.toplam.toFixed(2)]).toEqual(["399.00", "79.80", "478.80"]);
    const y = abonelikTutari("profesyonel", 12)!;
    expect([y.matrah.toFixed(2), y.kdv.toFixed(2), y.toplam.toFixed(2)]).toEqual(["11988.00", "2397.60", "14385.60"]);
  });

  it("eski 'v1' kaydı Profesyonel sayılır; fiyatsız ve bilinmeyen plan çevrim içi ödenmez", () => {
    expect(abonelikTutari("v1", 1)?.planKodu).toBe("profesyonel");
    expect(abonelikTutari("kurumsal", 1)).toBeNull();
    expect(abonelikTutari("yok", 1)).toBeNull();
  });
});

describe("e-posta ödeme bağlantısı anahtarı (PLT-13)", () => {
  const tenantId = "3f1c2a4e-1b2c-4d5e-8f90-1234567890ab";
  process.env.JWT_SECRET ??= "test-sirri";

  it("imzalı anahtar firmayı verir; süresi dolunca ya da değiştirilince geçersizdir", () => {
    const simdi = new Date("2026-10-29T10:00:00Z");
    const anahtar = baglantiAnahtariUret(tenantId, simdi);
    expect(baglantiAnahtariDogrula(anahtar, simdi)).toBe(tenantId);
    expect(baglantiAnahtariDogrula(anahtar, new Date("2026-12-14T10:00:00Z"))).toBeNull(); // 46. gün
    const [, son, imza] = anahtar.split(".");
    expect(baglantiAnahtariDogrula(`4f1c2a4e-1b2c-4d5e-8f90-1234567890ab.${son}.${imza}`, simdi)).toBeNull();
    expect(baglantiAnahtariDogrula(`${tenantId}.${(parseInt(son, 36) + 1).toString(36)}.${imza}`, simdi)).toBeNull();
    expect(baglantiAnahtariDogrula("bozuk", simdi)).toBeNull();
  });
});

describe("alıcı adı", () => {
  it("son kelime soyad; tek kelimede ikisi de aynı", () => {
    expect(adSoyadAyir("Ayşe Nur Yılmaz")).toEqual({ ad: "Ayşe Nur", soyad: "Yılmaz" });
    expect(adSoyadAyir("Mustafa")).toEqual({ ad: "Mustafa", soyad: "Mustafa" });
  });
});
