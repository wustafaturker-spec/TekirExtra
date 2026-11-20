import { describe, expect, it } from "vitest";
import { arayuzSonuclariniAyristir, metindekiSayilar, panelYolunuCoz, tutarKaynaktaVar } from "./arayuz-eylemleri";
import { ekranDurumunuAyristir } from "./ekran-durumu";

const ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

describe("arayüz eylemleri sözleşmesi (AI-114)", () => {
  it("panel yolu: izinli biçimler ve kimlikleri", () => {
    expect(panelYolunuCoz("/panel/fatura?yon=satis&durum=kesin")).toEqual({ yol: "/panel/fatura?yon=satis&durum=kesin", kayitlar: [] });
    expect(panelYolunuCoz(`/panel/cari/${ID.toUpperCase()}`)).toEqual({ yol: `/panel/cari/${ID.toUpperCase()}`, kayitlar: [{ tur: "cari", id: ID }] });
    expect(panelYolunuCoz(`/panel/fatura?faturaId=${ID}`)?.kayitlar).toEqual([{ tur: "fatura", id: ID }]);
    expect(panelYolunuCoz(`/panel/kasa-banka/hesap-ekstresi?hesap=banka:${ID}`)?.kayitlar).toEqual([{ tur: "kasa_banka_hesabi", id: `banka:${ID}` }]);
  });

  it("panel yolu: dış adres, üst dizin, bilinmeyen parametre ve biçimsiz kimlik reddedilir", () => {
    for (const y of ["https://kotu.example/panel", "/panel/../api", "//kotu.example", "/api/ekler", "/panel/fatura?yonlendir=http://x", "/panel/fatura#x", "/panel/fatura?faturaId=FTR1", `/panel/cari/${ID}/sil/x/y`, "/panel/a/b/c/d/e"]) {
      expect(panelYolunuCoz(y), y).toBeNull();
    }
  });

  it("tutar kaynakta Türkçe, İngilizce ve düz biçimde bulunur", () => {
    expect(metindekiSayilar("Toplam 1.250,50 TL")).toContain(1250.5);
    expect(tutarKaynaktaVar(1250.5, '{"genelToplam":"1250.50"}')).toBe(true);
    expect(tutarKaynaktaVar(1250.5, "birim fiyatı 1.250,50 olsun")).toBe(true);
    expect(tutarKaynaktaVar(3000, "fiyatı 1.250,50 olsun")).toBe(false);
  });

  it("istemci sonuçları ve ekran formu sözleşmeye indirgenir", () => {
    expect(arayuzSonuclariniAyristir([{ tur: "suzgec_uygula", sonuc: "basarili" }, { tur: "sil", sonuc: "basarili" }, { tur: "formu_doldur", sonuc: "<x>" }])).toEqual([{ tur: "suzgec_uygula", sonuc: "basarili" }]);
    expect(ekranDurumunuAyristir({ ekran: "faturalar", form: "fatura" })).toEqual({ ekran: "faturalar", form: "fatura" });
    expect(ekranDurumunuAyristir({ ekran: "faturalar", form: "bordro" })).toEqual({ ekran: "faturalar" });
  });
});
