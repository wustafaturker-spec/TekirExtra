import { describe, expect, it } from "vitest";
import { EKRAN_SECILI_SINIRI, ekranDurumunuAyristir, ekranSuzgecDegeri } from "./ekran-durumu";

const ID = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";

describe("ekran durumu (AI-113)", () => {
  it("tanımsız ekran, dizi ve ilkel değer reddedilir", () => {
    expect(ekranDurumunuAyristir({ ekran: "maaslar" })).toBeNull();
    expect(ekranDurumunuAyristir({ ekran: "__proto__" })).toBeNull();
    expect(ekranDurumunuAyristir([])).toBeNull();
    expect(ekranDurumunuAyristir("faturalar")).toBeNull();
  });

  it("yalnız izinli süzgeç alanları ve biçime uyan değerler kalır", () => {
    expect(ekranDurumunuAyristir({
      ekran: "kasa_banka_hareketleri",
      suzgecler: { hesap: `banka:${ID.toUpperCase()}`, baslangic: "2026-11-01", bitis: "dün", tur: "Tahsilat!", arama: "  kira\n ödemesi  ", tutar: "1000", iban: "TR00" },
    })).toEqual({ ekran: "kasa_banka_hareketleri", suzgecler: { hesap: `banka:${ID}`, baslangic: "2026-11-01", arama: "kira ödemesi" } });
  });

  it("seçili kimlikler tekilleşir, UUID olmayan düşer, sınırda kesilir; seçimsiz ekranda taşınmaz", () => {
    const fazla = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const d = ekranDurumunuAyristir({ ekran: "faturalar", secili: [ID, ID.toUpperCase(), "FTR1", 5, ...fazla] });
    expect(d?.secili?.[0]).toBe(ID);
    expect(d?.secili).toHaveLength(EKRAN_SECILI_SINIRI);
    expect(ekranDurumunuAyristir({ ekran: "masraflar", secili: [ID] })).toEqual({ ekran: "masraflar" });
  });

  it("sekme ve sayfa biçim denetiminden geçer", () => {
    expect(ekranDurumunuAyristir({ ekran: "onaylar", sekme: "bekleyen", sayfa: 2, suzgecler: { kutu: "gecmis" } })).toEqual({ ekran: "onaylar", sekme: "bekleyen", sayfa: 2, suzgecler: { kutu: "gecmis" } });
    expect(ekranDurumunuAyristir({ ekran: "onaylar", sekme: "<script>", sayfa: -1 })).toEqual({ ekran: "onaylar" });
  });

  it("süzgeç türleri", () => {
    expect(ekranSuzgecDegeri("metin", "x".repeat(150))).toHaveLength(100);
    expect(ekranSuzgecDegeri("hesap", `kredi:${ID}`)).toBeNull();
    expect(ekranSuzgecDegeri("cari", "Deneme A.Ş.")).toBeNull();
    expect(ekranSuzgecDegeri("kod", "")).toBeNull();
  });
});
