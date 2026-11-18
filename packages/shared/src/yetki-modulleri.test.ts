import { describe, expect, it } from "vitest";
import { gecerliYetkiAnahtariMi, ozelRolIstegiKapali, ozelRolPanelYoluKapali, yolIslemi, yolModulu, YETKI_MODULLERI } from "./yetki-modulleri";

describe("özel rol yetki matrisi (KLN-20)", () => {
  it("yol modülü en uzun önekten çözülür", () => {
    expect(yolModulu("/api/v1/fatura/12/kesinlestir")?.kod).toBe("fatura");
    expect(yolModulu("kasa-banka/krediler")?.kod).toBe("kasa_banka");
    expect(yolModulu("ai/teklif-talepleri/3")?.kod).toBe("satis");
    expect(yolModulu("ai/ajan/sohbet")?.kod).toBe("yapay_zeka");
    expect(yolModulu("eposta/gelen")?.kod).toBe("satis");
    expect(yolModulu("eposta/ayarlar")?.kod).toBe("ayarlar");
    expect(yolModulu("faturalar")).toBeNull();
    expect(yolModulu("auth/ben")).toBeNull();
    expect(yolModulu("bildirimler/ozet")).toBeNull();
  });

  it("işlem yöntem ve eylem bölütünden çıkar", () => {
    expect(yolIslemi("GET", "fatura/1")).toBe("goruntule");
    expect(yolIslemi("POST", "raporlar/x/calistir", true)).toBe("goruntule");
    expect(yolIslemi("POST", "fatura")).toBe("duzenle");
    expect(yolIslemi("PATCH", "fatura/1")).toBe("duzenle");
    expect(yolIslemi("POST", "fatura/1/kesinlestir")).toBe("onayla");
    expect(yolIslemi("POST", "kasa-banka/odeme-talimatlari/1/onayla")).toBe("onayla");
    expect(yolIslemi("POST", "fatura/1/iptal")).toBe("sil");
    expect(yolIslemi("DELETE", "cari/1")).toBe("sil");
    expect(yolIslemi("POST", "belgeler/1/pdf-gonder")).toBe("duzenle");
  });

  it("kapalı kutu yalnız kendi modül/işlemini engeller; ortak ayar okumaları açık kalır", () => {
    const kapali = ["kasa_banka.goruntule", "fatura.onayla", "ayarlar.goruntule", "ayarlar.duzenle"];
    expect(ozelRolIstegiKapali(kapali, "GET", "kasa-banka/hesaplar")).toBe(true);
    expect(ozelRolIstegiKapali(kapali, "POST", "kasa-banka/hesaplar")).toBe(false);
    expect(ozelRolIstegiKapali(kapali, "POST", "fatura/1/kesinlestir")).toBe(true);
    expect(ozelRolIstegiKapali(kapali, "POST", "fatura")).toBe(false);
    expect(ozelRolIstegiKapali(kapali, "GET", "firma")).toBe(false);
    expect(ozelRolIstegiKapali(kapali, "PATCH", "firma")).toBe(true);
    expect(ozelRolIstegiKapali([], "GET", "kasa-banka/hesaplar")).toBe(false);
  });

  it("rol yönetimi ve düzeltme kayıtları modüle bağlıdır; denetim izi okuması kutuya bağlıdır", () => {
    expect(yolModulu("ozel-roller/1")?.kod).toBe("ayarlar");
    expect(ozelRolIstegiKapali(["ayarlar.duzenle"], "PATCH", "ozel-roller/1")).toBe(true);
    expect(ozelRolIstegiKapali(["ayarlar.sil"], "DELETE", "ozel-roller/1")).toBe(true);
    expect(yolModulu("duzeltmeler")?.kod).toBe("donem_kapatma");
    expect(ozelRolIstegiKapali(["donem_kapatma.goruntule"], "GET", "duzeltmeler")).toBe(true);
    expect(ozelRolIstegiKapali(["ayarlar.goruntule"], "GET", "denetim")).toBe(true);
    expect(ozelRolIstegiKapali(["ayarlar.goruntule"], "GET", "/api/v1/eposta/gecmis")).toBe(true);
    expect(ozelRolIstegiKapali(["ayarlar.goruntule"], "GET", "eposta/ayarlar")).toBe(false);
    expect(ozelRolIstegiKapali(["ayarlar.goruntule"], "GET", "kullanicilar")).toBe(false);
  });

  it("menü yolu görüntüleme kapalı modülde gizlenir", () => {
    expect(ozelRolPanelYoluKapali(["kasa_banka.goruntule"], "/panel/kasa-banka/krediler")).toBe(true);
    expect(ozelRolPanelYoluKapali(["kasa_banka.goruntule"], "/panel/kasa-banka/kur-farki")).toBe(false);
    expect(ozelRolPanelYoluKapali(["satis.goruntule"], "/panel/stok/fiyat-listeleri")).toBe(true);
    expect(ozelRolPanelYoluKapali(["stok.goruntule"], "/panel/stok/fiyat-listeleri")).toBe(false);
    expect(ozelRolPanelYoluKapali(["kasa_banka.duzenle"], "/panel/kasa-banka")).toBe(false);
  });

  it("18 modül, kodlar tekil", () => {
    expect(YETKI_MODULLERI).toHaveLength(18);
    expect(new Set(YETKI_MODULLERI.map((m) => m.kod)).size).toBe(18);
  });
});

it("endeks özel rol kutuları geçerli ve araç/istek süzgecine bağlıdır", () => {
  const satis = "fiyat_endeks_satis.goruntule", alis = "fiyat_endeks_alis.goruntule";
  expect(gecerliYetkiAnahtariMi(satis)).toBe(true);
  expect(gecerliYetkiAnahtariMi(alis)).toBe(true);
  expect(gecerliYetkiAnahtariMi("fiyat_endeks_alis.duzenle")).toBe(false);
  expect(ozelRolIstegiKapali([satis, alis], "GET", "/api/v1/fiyat-endeks/secenekler")).toBe(true);
  expect(ozelRolIstegiKapali([alis], "GET", "fiyat-endeks/secenekler")).toBe(false);
  expect(ozelRolIstegiKapali([satis], "GET", "fiyat-endeks/fiyat-onerisi")).toBe(true);
});
