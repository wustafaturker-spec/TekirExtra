import { describe, expect, it } from "vitest";
import { senaryoHatalari, izinliIstisnaKodlari, ihracKayitliHatalari } from "./fatura-senaryo";
import { kdvOraniHatasi, kodTablosuKur, VARSAYILAN_KOD_TABLOSU } from "./kod-tablosu";
import { ozelMatrahHatalari } from "./ozel-matrah";

const tablo2022 = kodTablosuKur({
  kdvOrani: [{ anahtar: "0", deger: {} }, { anahtar: "1", deger: {} }, { anahtar: "8", deger: {} }, { anahtar: "18", deger: {} }],
  istisna: [{ anahtar: "301", deger: { ad: "Mal ihracatı", istisnaTuru: "tam" } }, { anahtar: "351", deger: { ad: "İstisna olmayan", istisnaTuru: "tam" } }],
  ozelMatrah: [{ anahtar: "812", deger: { ad: "İkinci el" } }],
  ihracKayitli: [{ anahtar: "701", deger: { ad: "11/1-c" } }],
});

describe("belge tarihindeki kod tablosu (MVZ-11)", () => {
  it("merkezi kayıtlardan kurulur, oranlar sıralıdır", () => {
    expect(tablo2022.kdvOranlari.map((k) => k.oran)).toEqual([0, 1, 8, 18]);
    expect(tablo2022.istisna[0]).toEqual({ kod: "301", ad: "Mal ihracatı", tur: "tam" });
  });

  it("KDV oranı belge tarihindeki listede olmalı", () => {
    expect(kdvOraniHatasi(18, tablo2022.kdvOranlari)).toBeNull();
    expect(kdvOraniHatasi("20", tablo2022.kdvOranlari)).toMatch(/%20 belge tarihinde geçerli değil; geçerli oranlar: %0, %1, %8, %18/);
    expect(kdvOraniHatasi(18, VARSAYILAN_KOD_TABLOSU.kdvOranlari)).toMatch(/geçerli değil/);
  });

  it("senaryo kuralı tablo verilince oranı ve istisna kodunu tabloda arar; null istisna üyeliğini atlar", () => {
    const h = senaryoHatalari([{ kdvOrani: 20 }, { kdvOrani: 0, gibIstisnaKodu: "201" }], false, { kodTablosu: tablo2022 });
    expect(h.map((x) => `${x.satirIndeksi}:${x.alan}`)).toEqual(["0:kdvOrani", "1:gibIstisnaKodu"]);
    expect(senaryoHatalari([{ kdvOrani: 0, gibIstisnaKodu: "999" }], false, { kodTablosu: null })).toEqual([]);
    // Tablo verilmezse oran denetlenmez (eski çağrılar).
    expect(senaryoHatalari([{ kdvOrani: 18 }])).toEqual([]);
  });

  it("istisna seçenekleri, özel matrah ve ihraç kayıtlı kodu verilen listeden", () => {
    expect(izinliIstisnaKodlari([{}], tablo2022.istisna).map((k) => k.kod)).toEqual(["301", "351"]);
    expect(izinliIstisnaKodlari([{ tevkifatKodu: "603" }], tablo2022.istisna).map((k) => k.kod)).toEqual(["351"]);
    const om = { tip: "satis", ozelMatrahKodu: "806", ozelMatrahTutari: "0", ozelMatrahOrani: "0", satirlar: [{ kdvOrani: 0 }] };
    expect(ozelMatrahHatalari(om, tablo2022.ozelMatrah)[0]).toMatch(/Tanımsız özel matrah kodu: 806/);
    expect(ozelMatrahHatalari(om, null)).toEqual([]);
    expect(ihracKayitliHatalari({ tip: "satis", ihracKayitliKodu: "702", satirlar: [] }, tablo2022.ihracKayitli)[0]).toMatch(/Tanımsız ihraç kayıtlı kodu/);
    expect(ihracKayitliHatalari({ tip: "satis", ihracKayitliKodu: "702", satirlar: [] }, null)).toEqual([]);
  });
});
