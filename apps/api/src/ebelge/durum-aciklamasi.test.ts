import { describe, expect, it } from "vitest";
import { durumAciklamasi } from "./durum-aciklamasi";

describe("durumAciklamasi", () => {
  it("başarı açıklamasını uyarı alanına yazmaz", () => {
    expect(durumAciklamasi({ durum: "iletildi", detay: "1300 BASARIYLA TAMAMLANDI" })).toEqual({ hataMesaji: null });
    expect(durumAciklamasi({ durum: "kuyrukta", detay: "ZARF BAŞARIYLA İŞLENDİ" })).toEqual({ hataMesaji: null });
    expect(durumAciklamasi({ durum: "kabul", detay: "Kabul" })).toEqual({ hataMesaji: null });
  });

  it("hatayı hata mesajı olarak tutar", () => {
    expect(durumAciklamasi({ durum: "hata", detay: "NES 422: HATALI ISTEK" })).toEqual({ hataMesaji: "NES 422: HATALI ISTEK" });
  });

  it("sağlayıcıda iptal edilmiş e-Arşiv belgesini uyarı olarak tutar", () => {
    expect(durumAciklamasi({ durum: "iletildi", detay: "Belge NES'te iptal edilmiş", iptalEdilmis: true })).toEqual({
      hataMesaji: "Belge NES'te iptal edilmiş",
    });
  });

  it("alıcının ret notunu alıcı notuna yazar", () => {
    expect(durumAciklamasi({ durum: "ret", detay: "Birim fiyat hatalı" })).toEqual({ hataMesaji: null, aliciYanitNotu: "Birim fiyat hatalı" });
  });

  it("gelen yanıt taramasından gelmiş notu ezmez", () => {
    expect(durumAciklamasi({ durum: "ret", detay: "Birim fiyat hatalı" }, "Yanıt belgesindeki gerekçe")).toEqual({ hataMesaji: null });
  });
});
