import { describe, expect, it } from "vitest";
import {
  aralikCoz,
  aylikTopla,
  kdvAyristir,
  oncekiAralik,
  ozetle,
  satirCevir,
  son12Ay,
  suz,
  trGunu,
  type HamOdemeSatiri,
} from "./odeme-raporu";

const ham = (x: Partial<HamOdemeSatiri> = {}): HamOdemeSatiri => ({
  odeme_id: "o1",
  tenant_id: "t1",
  unvan: " Çağrı Ticaret ",
  vkn: "1234567890",
  odeme_at: new Date("2026-11-01T10:00:00Z"),
  ay_sayisi: 1,
  tutar: "1198.80",
  matrah: "999.00",
  kdv: "199.80",
  kaynak: "saglayici",
  saglayici: "iyzico",
  kanal: "panel",
  onceki_donem_sonu: null,
  yeni_donem_sonu: new Date("2026-12-01T10:00:00Z"),
  odeme_notu: null,
  kaydeden: null,
  fatura_no: null,
  fatura_durumu: null,
  ...x,
});

describe("PLT-32 satır dönüşümü", () => {
  it("sağlayıcı ödemesinde matrah/KDV olduğu gibi kalır, kanal denemeden gelir", () => {
    const s = satirCevir(ham({ kanal: "otomatik", fatura_no: "ABF2026000000001", fatura_durumu: "tahsil_edildi" }));
    expect(s).toMatchObject({ unvan: "Çağrı Ticaret", toplam: "1198.80", matrah: "999.00", kdv: "199.80", kdvHesaplandi: false, kanal: "otomatik", fatura: { no: "ABF2026000000001", durum: "tahsil_edildi" } });
  });

  it("elle ödemede matrah/KDV %20 ile ayrıştırılır ve işaretlenir; toplam korunur", () => {
    const s = satirCevir(ham({ kaynak: "elle", saglayici: null, kanal: null, tutar: "5500.00", matrah: null, kdv: null, kaydeden: "Admin" }));
    expect(s).toMatchObject({ kanal: "elle", kaynak: "elle", matrah: "4583.33", kdv: "916.67", toplam: "5500.00", kdvHesaplandi: true, kaydeden: "Admin" });
  });

  it("denemesi bulunmayan sağlayıcı ödemesi 'saglayici' kanalına düşer", () => {
    expect(satirCevir(ham({ kanal: null })).kanal).toBe("saglayici");
  });

  it("KDV ayrıştırma kuruşu kaybetmez", () => {
    for (const t of ["0.00", "0.01", "100.00", "1198.80", "333.33"]) {
      const { matrah, kdv } = kdvAyristir(t);
      expect(matrah.add(kdv).toFixed(2)).toBe(t);
    }
  });
});

describe("PLT-33 süzgeçler", () => {
  const satirlar = [
    satirCevir(ham({ odeme_id: "a", unvan: "İSTANBUL GIDA", kanal: "panel", fatura_durumu: "hata" })),
    satirCevir(ham({ odeme_id: "b", unvan: "Ankara Yapı", vkn: "9876543210", saglayici: "paytr", kanal: "eposta" })),
    satirCevir(ham({ odeme_id: "c", unvan: "Elle Firma", kaynak: "elle", saglayici: null, kanal: null, matrah: null, kdv: null })),
  ];
  const idler = (x: typeof satirlar) => x.map((s) => s.odemeId);

  it("firma araması Türkçe büyük/küçük harften ve VKN'den bağımsız", () => {
    expect(idler(suz(satirlar, { arama: "istanbul" }))).toEqual(["a"]);
    expect(idler(suz(satirlar, { arama: "98765" }))).toEqual(["b"]);
  });

  it("kanal, sağlayıcı ve fatura durumu (faturasız dahil)", () => {
    expect(idler(suz(satirlar, { kanal: "elle" }))).toEqual(["c"]);
    expect(idler(suz(satirlar, { saglayici: "paytr" }))).toEqual(["b"]);
    expect(idler(suz(satirlar, { faturaDurumu: "hata" }))).toEqual(["a"]);
    expect(idler(suz(satirlar, { faturaDurumu: "yok" }))).toEqual(["b", "c"]);
  });
});

describe("PLT-34 özet", () => {
  it("toplamlar ve kanal kırılımı; hesaplanan KDV işaretlenir", () => {
    const o = ozetle([
      satirCevir(ham()),
      satirCevir(ham({ kanal: "panel", tutar: "100.00", matrah: "83.33", kdv: "16.67" })),
      satirCevir(ham({ kaynak: "elle", saglayici: null, kanal: null, tutar: "120.00", matrah: null, kdv: null })),
    ]);
    expect(o).toEqual({
      adet: 3,
      toplam: "1418.80",
      matrah: "1182.33",
      kdv: "236.47",
      hesaplananVar: true,
      iade: "0.00",
      net: "1418.80",
      kanallar: [
        { kanal: "elle", adet: 1, toplam: "120.00" },
        { kanal: "panel", adet: 2, toplam: "1298.80" },
      ],
    });
  });

  it("boş kümede sıfırlar", () => {
    expect(ozetle([])).toEqual({ adet: 0, toplam: "0.00", matrah: "0.00", kdv: "0.00", hesaplananVar: false, iade: "0.00", net: "0.00", kanallar: [] });
  });

  it("PLT-46: iadeler toplanır, net tahsilat iadeler düşülerek verilir", () => {
    const o = ozetle([satirCevir(ham({ iade_tutari: "1198.80" })), satirCevir(ham({ iade_tutari: "100.00" })), satirCevir(ham())]);
    expect(o).toMatchObject({ toplam: "3596.40", iade: "1298.80", net: "2297.60" });
  });
});

describe("tarih aralığı (TR günü)", () => {
  it("kapsayıcı günleri TR gece yarısından yarı açık aralığa çevirir", () => {
    const a = aralikCoz("2026-11-01", "2026-11-30");
    expect(a).toEqual({ bas: new Date("2026-10-31T21:00:00Z"), bit: new Date("2026-11-30T21:00:00Z") });
  });

  it("geçersiz, ters ve 24 aydan uzun aralığı reddeder", () => {
    expect(aralikCoz("2026-02-30", "2026-03-01")).toEqual({ hata: "gecersiz_tarih" });
    expect(aralikCoz("2026-11-02", "2026-11-01")).toEqual({ hata: "ters_aralik" });
    expect(aralikCoz("2025-01-01", "2026-12-31")).not.toHaveProperty("hata");
    expect(aralikCoz("2025-01-01", "2027-01-01")).toEqual({ hata: "aralik_cok_uzun" });
  });

  it("önceki dönem aynı uzunlukta ve hemen öncesinde", () => {
    const a = aralikCoz("2026-11-01", "2026-11-30") as { bas: Date; bit: Date };
    const o = oncekiAralik(a.bas, a.bit);
    expect(trGunu(o.bas)).toBe("2026-10-02");
    expect(o.bit).toEqual(a.bas);
  });

  it("gece yarısına yakın ödeme TR gününe göre aya düşer", () => {
    expect(trGunu(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11-01");
  });
});

describe("PLT-34 aylık grafik", () => {
  it("son 12 ay bu ay dahil, boş aylar sıfır", () => {
    const { baslangic, aylar } = son12Ay(new Date("2026-11-15T09:00:00Z"));
    expect(baslangic).toBe("2025-12-01");
    expect(aylar[0]).toBe("2025-12");
    expect(aylar[11]).toBe("2026-11");
    const sonuc = aylikTopla(
      [satirCevir(ham({ odeme_at: new Date("2026-10-31T22:30:00Z") })), satirCevir(ham({ odeme_at: new Date("2026-03-05T10:00:00Z"), tutar: "10.00", matrah: "8.33", kdv: "1.67" }))],
      aylar,
    );
    expect(sonuc.find((x) => x.ay === "2026-11")).toEqual({ ay: "2026-11", adet: 1, toplam: "1198.80", matrah: "999.00" });
    expect(sonuc.find((x) => x.ay === "2026-03")?.toplam).toBe("10.00");
    expect(sonuc.find((x) => x.ay === "2026-10")?.adet).toBe(0);
  });
});
