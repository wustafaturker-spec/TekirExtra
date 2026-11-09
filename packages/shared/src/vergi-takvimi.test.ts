import { describe, expect, it } from "vitest";
import { mevzuatDegerHatalari } from "./mevzuat";
import { isGununeKaydir, vergiGunleriniCikar, vergiSonTarihHatasi, vergiTakvimAnahtari, vergiTakvimAnahtariCoz, vergiTakvimOnerisi, vergiTarihUyarisi } from "./vergi-takvimi";

describe("vergi takvimi önerisi", () => {
  it("hafta sonu ve tam gün tatilden izleyen iş gününe kayar", () => {
    expect(isGununeKaydir("2026-11-28")).toBe("2026-11-30"); // cumartesi
    expect(isGununeKaydir("2026-05-27")).toBe("2026-06-01"); // Kurban Bayramı + hafta sonu
  });

  it("arife iş günü sayılır ama uyarı verir", () => {
    expect(isGununeKaydir("2026-05-26")).toBe("2026-05-26");
    expect(vergiTarihUyarisi("2026-05-26")).toContain("arifesi");
    expect(vergiTarihUyarisi("2026-11-27")).toBeNull();
  });

  it("dönemi izleyen aya yazar, aralık dönemi sonraki yıla geçer", () => {
    const satirlar = vergiTakvimOnerisi(2026, { kdv1: 28 });
    expect(satirlar).toHaveLength(12);
    expect(satirlar.find((s) => s.ay === 10)?.sonTarih).toBe("2026-11-30");
    expect(satirlar.find((s) => s.ay === 12)?.sonTarih).toBe("2027-01-28");
  });

  it("ay sonu ve kısa ay", () => {
    const aySonu = vergiTakvimOnerisi(2027, { sgk: "ay_sonu" });
    expect(aySonu.find((s) => s.ay === 1)?.sonTarih).toBe("2027-03-01"); // 28 Şubat 2027 pazar
    expect(vergiTakvimOnerisi(2027, { sgk: 31 }).find((s) => s.ay === 3)?.sonTarih).toBe("2027-04-30");
  });

  it("üç aylık muhtasar yalnız çeyrek sonlarında", () => {
    const satirlar = vergiTakvimOnerisi(2026, { muhtasar3: 26 });
    expect(satirlar.map((s) => s.ay)).toEqual([3, 6, 9, 12]);
    expect(satirlar[0]?.sonTarih).toBe("2026-05-26");
  });

  it("önceki yılın kaymış tarihlerinden doğru günü çıkarır", () => {
    const yayinlanan = vergiTakvimOnerisi(2026, { kdv1: 28, sgk: "ay_sonu" });
    expect(vergiGunleriniCikar(yayinlanan, 2026)).toEqual({ kdv1: 28, sgk: "ay_sonu" });
  });
});

describe("vergi takvimi doğrulama", () => {
  it("anahtar gidiş dönüş", () => {
    expect(vergiTakvimAnahtari("kdv2", 2026, 3)).toBe("kdv2:2026-03");
    expect(vergiTakvimAnahtariCoz("kdv2:2026-03")).toEqual({ yukumluluk: "kdv2", yil: 2026, ay: 3 });
    expect(vergiTakvimAnahtariCoz("kdv2:2026-13")).toBeNull();
    expect(vergiTakvimAnahtariCoz("otv:2026-01")).toBeNull();
  });

  it("dönem bitmeden son tarih olamaz", () => {
    expect(vergiSonTarihHatasi(2026, 10, "2026-10-31")).toContain("dönem bittikten");
    expect(vergiSonTarihHatasi(2026, 10, "2026-11-28")).toBeNull();
    expect(vergiSonTarihHatasi(2026, 10, "2028-01-01")).toContain("bir yıldan");
    expect(vergiSonTarihHatasi(2026, 2, "2026-02-30")).toContain("geçerli");
  });

  it("Mevzuat doğrulaması anahtar ve tarihi birlikte denetler", () => {
    expect(mevzuatDegerHatalari("vergi_takvimi", "kdv1:2026-10", { sonTarih: "2026-11-30" })).toEqual([]);
    expect(mevzuatDegerHatalari("vergi_takvimi", "kdv1:2026-10", { sonTarih: "2026-10-30" }).join()).toContain("dönem bittikten");
    expect(mevzuatDegerHatalari("vergi_takvimi", "otv:2026-10", { sonTarih: "2026-11-30" })).not.toEqual([]);
    expect(mevzuatDegerHatalari("vergi_takvimi", "muhtasar3:2026-04", { sonTarih: "2026-06-26" }).join()).toContain("çeyrek");
  });
});
