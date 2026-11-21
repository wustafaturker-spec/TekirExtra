import { describe, expect, it } from "vitest";
import { AJAN_ARACLARI } from "./index";
import { DUSUK_RISKLI_ONAY_ARACLARI, FINANSAL_ONAY_ARACLARI, onayRiski } from "./onay-riski";

describe("AI-108 onay riski", () => {
  const onayAraclari = AJAN_ARACLARI.filter((a) => a.sinif === "onay").map((a) => a.ad);

  it("her onay aracı tam olarak bir risk listesindedir ve listelerde tanımsız araç yoktur", () => {
    const siniflanmamis = onayAraclari.filter((a) => FINANSAL_ONAY_ARACLARI.has(a) === DUSUK_RISKLI_ONAY_ARACLARI.has(a));
    expect(siniflanmamis).toEqual([]);
    const tanimsiz = [...FINANSAL_ONAY_ARACLARI, ...DUSUK_RISKLI_ONAY_ARACLARI].filter((a) => !onayAraclari.includes(a));
    expect(tanimsiz).toEqual([]);
  });

  it("isterdeki finansal işlemler finansal, kart ve taslak işlemleri düşük risklidir; bilinmeyen araç finansaldır", () => {
    for (const a of ["masraf_tamamla", "fatura_kesinlestir", "kasa_banka_hareketi_kaydet", "ekstre_satiri_eslestir", "ebelge_gonder", "odeme_hatirlatmasi_gonder"]) {
      expect(onayRiski(a)).toBe("finansal");
    }
    for (const a of ["cari_olustur", "cari_guncelle", "stok_karti_olustur", "stok_karti_guncelle"]) expect(onayRiski(a)).toBe("dusuk");
    expect(onayRiski("yeni_bilinmeyen_arac")).toBe("finansal");
  });
});
