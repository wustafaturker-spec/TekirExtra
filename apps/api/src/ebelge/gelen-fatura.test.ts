import { describe, expect, it } from "vitest";
import { gelenFaturaGirdisi, gelenFaturaHesabi, gelenFaturaTipi, tevkifatOraniMetni, tutarDenetimi } from "./gelen-fatura";
import type { UblFatura, UblSatir } from "./ubl-oku";
import { tevkifatTablosuCoz } from "@tekirextra/shared";

const STOK = "11111111-1111-4111-8111-111111111111";
const eslesme = () => ({ stokId: STOK });

const satir = (s: Partial<UblSatir> = {}): UblSatir => ({
  siraNo: 1, ad: "Ürün", miktar: 10, birim: "adet", birimFiyat: 100, iskontoOrani: 0, iskontoTutari: 0,
  kdvOrani: 20, kdvTutari: 200, matrah: 1000, digerVergiler: [], ...s,
});

const belge = (b: Partial<UblFatura> & { toplamlar?: Partial<UblFatura["toplamlar"]> } = {}): UblFatura => {
  const { toplamlar, ...geri } = b;
  return {
    uuid: "u", belgeNo: "ABC2026000000001", profilId: "TICARIFATURA", faturaTipKodu: "SATIS", tarih: "2026-10-01",
    notlar: [], irsaliyeler: [], istisnaKodlari: [], iadeReferanslari: [], dovizCinsi: "TRY",
    gonderen: { vknTckn: "1234567890", unvan: "Tedarikçi" }, alici: { vknTckn: "1234567801", unvan: "Biz" },
    satirlar: [satir()],
    ...geri,
    toplamlar: {
      satirToplami: 1000, iskontoToplami: 0, matrah: 1000, kdv: 200, genelToplam: 1200, kdvSaf: 200, vergiParaBirimi: "TRY",
      tevkifat: 0, tevkifatKodlari: [], odenecek: 1200, vergiDahil: 1200, belgeIskontosu: 0, belgeArtirimi: 0, digerVergiler: [], ...toplamlar,
    },
  };
};

const denetle = (ubl: UblFatura, ihracKayitli = false) => {
  const { girdi, engeller } = gelenFaturaGirdisi(ubl, eslesme);
  return { girdi, engeller, denetim: tutarDenetimi(ubl, gelenFaturaHesabi(girdi, ihracKayitli), ihracKayitli) };
};

describe("gelen fatura tipi (EBLG-119)", () => {
  it("IADE ve TEVKIFATIADE satış iadesidir, diğerleri alış", () => {
    expect(gelenFaturaTipi({ faturaTipKodu: "IADE" })).toBe("satis_iade");
    expect(gelenFaturaTipi({ faturaTipKodu: "TEVKIFATIADE" })).toBe("satis_iade");
    expect(gelenFaturaTipi({ faturaTipKodu: "TEVKIFAT" })).toBe("alis");
  });
});

describe("gelen fatura tutar kapısı (EBLG-115)", () => {
  it("tutan belgede engel ve fark yok", () => {
    const { engeller, denetim } = denetle(belge());
    expect(engeller).toEqual([]);
    expect(denetim.gecerli).toBe(true);
    expect(denetim.satirlar.every((f) => f.fark === 0)).toBe(true);
  });

  it("tolerans satır × 0,01, en az 0,05; aşan fark işlemi durdurur", () => {
    expect(denetle(belge({ toplamlar: { odenecek: 1200.04 } })).denetim.gecerli).toBe(true);
    const asan = denetle(belge({ toplamlar: { odenecek: 1200.06 } })).denetim;
    expect(asan.gecerli).toBe(false);
    expect(asan.asanlar.map((f) => f.alan)).toEqual(["odenecek"]);
    const onSatir = belge({ satirlar: Array.from({ length: 10 }, (_, i) => satir({ siraNo: i + 1, miktar: 1 })), toplamlar: { odenecek: 1200.09 } });
    expect(denetle(onSatir).denetim.tolerans).toBeCloseTo(0.1);
  });

  it("vergi toplamı başka dövizdeyse KDV satırı atlanır", () => {
    const { denetim } = denetle(belge({ dovizCinsi: "USD", kur: 41.5, toplamlar: { kdvSaf: 8300, vergiParaBirimi: "TRY" } }));
    expect(denetim.satirlar.map((f) => f.alan)).toEqual(["matrah", "tevkifat", "odenecek"]);
    expect(denetim.gecerli).toBe(true);
  });

  it("ihraç kayıtlıda ödenecek yerine vergi dahil toplam karşılaştırılır (K072026000000110)", () => {
    const ubl = belge({ satirlar: [satir({ miktar: 1, birimFiyat: 27.88, matrah: 27.88, kdvOrani: 10, kdvTutari: 2.79 })], toplamlar: { matrah: 27.88, kdvSaf: 2.79, odenecek: 27.88, vergiDahil: 30.67, genelToplam: 27.88 } });
    expect(denetle(ubl, true).denetim.gecerli).toBe(true);
  });
});

describe("gelen özel matrah (EBLG-116)", () => {
  it("kod, tutar ve oran taşınır; satırlar KDV'siz yazılır (K072026000000106)", () => {
    const ubl = belge({
      faturaTipKodu: "OZELMATRAH",
      satirlar: [satir({ miktar: 1, birimFiyat: 450000, matrah: 450000, kdvOrani: 0, kdvTutari: 0 })],
      toplamlar: { matrah: 450000, ozelMatrah: 29166.67, ozelMatrahKodu: "812", ozelMatrahOrani: 20, kdvSaf: 5833.33, odenecek: 455833.33 },
    });
    const { girdi, engeller, denetim } = denetle(ubl);
    expect(engeller).toEqual([]);
    expect(girdi).toMatchObject({ ozelMatrahKodu: "812", ozelMatrahTutari: "29166.67", ozelMatrahOrani: "20" });
    expect(girdi.satirlar[0].kdvOrani).toBe("0");
    expect(denetim.gecerli).toBe(true);
  });

  it("birden çok özel matrah kodunda durur (NEY2026000000112)", () => {
    const ubl = belge({ faturaTipKodu: "OZELMATRAH", istisnaKodlari: ["802", "810"], toplamlar: { ozelMatrahKodu: "802" } });
    expect(denetle(ubl).engeller.join()).toMatch(/birden çok özel matrah kodu.*802, 810/);
  });

  it("tanınmayan özel matrah kodunda durur", () => {
    const ubl = belge({ faturaTipKodu: "OZELMATRAH", toplamlar: { ozelMatrahKodu: "999" } });
    expect(denetle(ubl).engeller[0]).toMatch(/Özel matrah kodu tanınmıyor/);
  });
});

describe("gelen tevkifat (EBLG-117)", () => {
  it("tek oranlı kodda oran koddan, 650'de belgeden gelir", () => {
    expect(tevkifatOraniMetni(70)).toBe("7/10");
    const tek = denetle(belge({ faturaTipKodu: "TEVKIFAT", satirlar: [satir({ tevkifat: { kod: "604", oran: 50, tutar: 100 } })], toplamlar: { tevkifat: 100, odenecek: 1100 } }));
    expect(tek.girdi.satirlar[0]).toMatchObject({ tevkifatKodu: "604", tevkifatOrani: null });
    expect(tek.denetim.gecerli).toBe(true);
    const diger = denetle(belge({ faturaTipKodu: "TEVKIFAT", satirlar: [satir({ tevkifat: { kod: "650", oran: 20, tutar: 40 } })], toplamlar: { tevkifat: 40, odenecek: 1160 } }));
    expect(diger.girdi.satirlar[0]).toMatchObject({ tevkifatKodu: "650", tevkifatOrani: "2/10" });
    expect(diger.denetim.gecerli).toBe(true);
  });

  it("yalnız başlıkta yazılan tek tevkifat kodu KDV'li satırlara uygulanır (TRK2026000000037)", () => {
    const ubl = belge({ faturaTipKodu: "TEVKIFAT", satirlar: [satir({ miktar: 1, birimFiyat: 500, matrah: 500, kdvTutari: 100 })], toplamlar: { matrah: 500, kdvSaf: 100, tevkifat: 50, tevkifatKodlari: [{ kod: "604", oran: 50, tutar: 50 }], odenecek: 550 } });
    const { girdi, engeller, denetim } = denetle(ubl);
    expect(engeller).toEqual([]);
    expect(girdi.satirlar[0].tevkifatKodu).toBe("604");
    expect(denetim.gecerli).toBe(true);
    // 604 sistemde 5/10; belge %70 diyorsa fark yerine açık engel.
    const yetmis = belge({ faturaTipKodu: "TEVKIFAT", toplamlar: { tevkifatKodlari: [{ kod: "604", oran: 70, tutar: 140 }] } });
    expect(denetle(yetmis).engeller.join()).toMatch(/604 kodu %70 oranla yazılmış; sistemdeki oranı 5\/10/);
    const ikiKod = belge({ toplamlar: { tevkifatKodlari: [{ kod: "604", oran: 50, tutar: 50 }, { kod: "650", oran: 20, tutar: 20 }] } });
    expect(denetle(ikiKod).engeller.join()).toMatch(/birden çok kodla/);
  });

  it("firmanın tablosu kullanılır: güncel varsayılanla 601 %40 geçer, değiştirilen oranla durur (FTR-35)", () => {
    const ubl = belge({ faturaTipKodu: "TEVKIFAT", satirlar: [satir({ tevkifat: { kod: "601", oran: 40, tutar: 80 } })], toplamlar: { tevkifat: 80, odenecek: 1120 } });
    expect(denetle(ubl).engeller).toEqual([]);
    expect(denetle(ubl).denetim.gecerli).toBe(true);
    const tablo = tevkifatTablosuCoz([{ kod: "601", oranlar: ["3/10"] }]);
    expect(gelenFaturaGirdisi(ubl, eslesme, tablo).engeller.join()).toMatch(/601 kodu %40.*3\/10 \(Ayarlar > Tevkifat\)/);
    // Pasif kod gelen belgede yine tanınır.
    expect(gelenFaturaGirdisi(ubl, eslesme, tevkifatTablosuCoz([{ kod: "601", pasif: true }])).engeller).toEqual([]);
  });

  it("tanınmayan kodda ve 650'ye uymayan oranda durur", () => {
    expect(denetle(belge({ satirlar: [satir({ tevkifat: { kod: "699", oran: 50, tutar: 100 } })] })).engeller[0]).toMatch(/tevkifat kodu tanınmıyor/);
    expect(denetle(belge({ satirlar: [satir({ tevkifat: { kod: "650", oran: 40, tutar: 80 } })] })).engeller[0]).toMatch(/koduna uymuyor/);
  });
});

describe("gelen kur, belge iskontosu ve diğer vergiler (EBLG-118/120)", () => {
  it("dövizde kur belgeden, belge iskontosu genel iskonto olur", () => {
    const ubl = belge({ dovizCinsi: "EUR", kur: 48.25, toplamlar: { belgeIskontosu: 100, matrah: 900, kdvSaf: 180, vergiParaBirimi: "EUR", odenecek: 1080 } });
    const { girdi, engeller, denetim } = denetle(ubl);
    expect(engeller).toEqual([]);
    expect(girdi).toMatchObject({ dovizCinsi: "EUR", kur: "48.250000", genelIskontoTutari: "100.00" });
    expect(denetim.gecerli).toBe(true);
  });

  it("kursuz dövizli belge, belge artırımı ve KDV dışı vergi işlemeyi durdurur", () => {
    expect(denetle(belge({ dovizCinsi: "USD" })).engeller.join()).toMatch(/kur yok/);
    expect(denetle(belge({ toplamlar: { belgeArtirimi: 50 } })).engeller.join()).toMatch(/artırım/);
    expect(denetle(belge({ toplamlar: { digerVergiler: [{ kod: "0059", ad: "Konaklama Vergisi", tutar: 20 }] } })).engeller.join()).toMatch(/EBLG-120.*Konaklama/);
  });
});
