import { describe, expect, it } from "vitest";
import { miktarEkle, miktarYaz, okutulaniCoz, partiSil, sayimGovdesi } from "./saha-sayim";

const urunler = [
  { id: "a", kod: "HM-001", ad: "Vida", anaBirim: "ADET", takipTipi: "yok", varyantlar: [] },
  { id: "b", kod: "TS-01", ad: "Tişört", anaBirim: "ADET", takipTipi: "yok", varyantlar: [{ id: "b1", kod: "TS-01-K", ad: "Kırmızı" }, { id: "b2", kod: "TS-01-M", ad: "Mavi" }] },
  { id: "c", kod: "IL-1", ad: "İlaç", anaBirim: "KUTU", takipTipi: "lot", varyantlar: [] },
  { id: "d", kod: "TL-1", ad: "Telefon", anaBirim: "ADET", takipTipi: "seri", varyantlar: [] },
];
const barkodlar = [
  { barkod: "869001", stokId: "a", varyantId: null, katsayi: 1, birim: "ADET" },
  { barkod: "869012", stokId: "a", varyantId: null, katsayi: 12, birim: "KOLI" },
  { barkod: "869100", stokId: "b", varyantId: null, katsayi: 1, birim: "ADET" },
  { barkod: "869101", stokId: "b", varyantId: "b1", katsayi: 1, birim: "ADET" },
];

describe("saha sayımı (SAH-03)", () => {
  it("barkod, koli katsayısı, varyant barkodu ve ürün kodu çözülür", () => {
    expect(okutulaniCoz("869012", urunler, barkodlar)).toMatchObject({ tur: "bulundu", varyantId: null, katsayi: 12 });
    expect(okutulaniCoz("869101", urunler, barkodlar)).toMatchObject({ tur: "bulundu", varyantId: "b1" });
    expect(okutulaniCoz("869100", urunler, barkodlar).tur).toBe("varyant_sec");
    expect(okutulaniCoz("hm-001", urunler, barkodlar)).toMatchObject({ tur: "bulundu", urun: { id: "a" } });
    expect(okutulaniCoz("ts-01-m", urunler, barkodlar)).toMatchObject({ tur: "bulundu", varyantId: "b2" });
    expect(okutulaniCoz("000", urunler, barkodlar)).toEqual({ tur: "bulunamadi", kod: "000" });
  });

  it("aynı ürün tekrar okutulunca miktar artar ve satır başa gelir; elle düzeltilir", () => {
    let s = miktarEkle([], urunler[0], null, 1);
    s = miktarEkle(s, urunler[1], "b1", 1);
    s = miktarEkle(s, urunler[0], null, 12);
    expect(s.map((x) => [x.kod, x.miktar])).toEqual([["HM-001", 13], ["TS-01-K", 1]]);
    expect(s[1].ad).toBe("Tişört · Kırmızı");
    s = miktarYaz(s, s[0].anahtar, 10.5);
    expect(s[0].miktar).toBe(10.5);
    expect(miktarYaz(s, s[0].anahtar, 0)).toHaveLength(1);
  });

  it("lot takipli ürün lot ister, aynı lot birleşir; seri her biri 1 adet ve tekrar etmez", () => {
    expect(() => miktarEkle([], urunler[2], null, 1)).toThrow(/lot numarasını/);
    let s = miktarEkle([], urunler[2], null, 2, { lotNo: "L1" });
    s = miktarEkle(s, urunler[2], null, 3, { lotNo: "L1" });
    s = miktarEkle(s, urunler[2], null, 1, { lotNo: "L2" });
    expect(s[0]).toMatchObject({ miktar: 6, partiler: [{ lotNo: "L1", miktar: 5 }, { lotNo: "L2", miktar: 1 }] });
    let t = miktarEkle([], urunler[3], null, 5, { lotNo: "L9", seriNo: "S1" });
    expect(t[0]).toMatchObject({ miktar: 1, partiler: [{ seriNo: "S1", miktar: 1 }] });
    expect(() => miktarEkle(t, urunler[3], null, 1, { lotNo: "L9", seriNo: "S1" })).toThrow(/zaten var/);
    t = partiSil(t, t[0].anahtar, 0);
    expect(t).toHaveLength(0);
  });

  it("gönderim gövdesi sayım şemasına uyar", () => {
    let s = miktarEkle([], urunler[0], null, 13);
    s = miktarEkle(s, urunler[2], null, 2, { lotNo: "L1" });
    expect(sayimGovdesi("depo-1", "2026-11-12", s, "")).toEqual({
      depoId: "depo-1", tarih: "2026-11-12", aciklama: "Saha sayımı",
      kalemler: [
        { stokId: "c", varyantId: null, fiiliMiktar: "2", partiler: [{ lotNo: "L1", seriNo: null, fiiliMiktar: "2" }] },
        { stokId: "a", varyantId: null, fiiliMiktar: "13" },
      ],
    });
  });
});
