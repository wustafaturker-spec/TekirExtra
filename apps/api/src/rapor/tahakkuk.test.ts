import { describe, expect, it } from "vitest";
import { kategoriOzeti, tahakkukSiniflandir, toplam, type TahakkukVerisi } from "./tahakkuk";

const g = (t: string) => new Date(`${t}T00:00:00.000Z`);
const bos: TahakkukVerisi = { faturalar: [], masraflar: [], gelirKayitlari: [], bordrolar: [] };

function fatura(p: Partial<TahakkukVerisi["faturalar"][number]> & { id: string; tip: string; toplamMatrah: number }): TahakkukVerisi["faturalar"][number] {
  return { no: `NO-${p.id}`, tarih: g("2026-09-05"), kur: 1, dovizCinsi: "TRY", aciklama: null, gelirTuru: "ticari_satis", cari: { unvan: "Cari" }, satirlar: [], ...p };
}

describe("tahakkukSiniflandir (BUT-01…BUT-04)", () => {
  it("satışı gelir türüne göre, KDV hariç ve belge kuruyla sayar", () => {
    const { kalemler } = tahakkukSiniflandir(
      { ...bos, faturalar: [fatura({ id: "f1", tip: "satis", toplamMatrah: 1000 }), fatura({ id: "f2", tip: "satis", toplamMatrah: 100, gelirTuru: "kira_geliri", kur: 40, dovizCinsi: "USD" })] },
    );
    expect(kalemler.find((k) => k.id === "f1")).toMatchObject({ tur: "gelir", anahtar: "satis:ticari_satis", tutarTry: 1000 });
    expect(kalemler.find((k) => k.id === "f2")).toMatchObject({ tur: "gelir", anahtar: "satis:kira_geliri", altKategori: "Kira Geliri", tutar: 100, tutarTry: 4000 });
  });

  it("alışı hizmet ve mal olarak ayırır ve genel iskontoya rağmen toplam matrahı korur", () => {
    const { kalemler } = tahakkukSiniflandir(
      {
        ...bos,
        faturalar: [fatura({
          id: "a1", tip: "alis", toplamMatrah: 900, // satırlar 1000, genel iskonto 100
          satirlar: [{ matrah: 250, stok: { tip: "hizmet" } }, { matrah: 750, stok: { tip: "urun" } }],
        })],
      },
    );
    expect(kalemler.find((k) => k.anahtar === "hizmet_alis")?.tutarTry).toBe(225);
    expect(kalemler.find((k) => k.anahtar === "mal_alis")?.tutarTry).toBe(675);
  });

  it("iadeleri ayrı kalem yapar: satış iadesi gider, alış iadesi gelir", () => {
    const { kalemler } = tahakkukSiniflandir(
      { ...bos, faturalar: [fatura({ id: "si", tip: "satis_iade", toplamMatrah: 50 }), fatura({ id: "ai", tip: "alis_iade", toplamMatrah: 30 })] },
    );
    expect(kalemler.find((k) => k.id === "si")).toMatchObject({ tur: "gider", anahtar: "satis_iadesi" });
    expect(kalemler.find((k) => k.id === "ai")).toMatchObject({ tur: "gelir", anahtar: "alis_iadesi" });
  });

  it("masrafı KDV hariç matrahla, kategori ağacında ve dövizliyse belge kuruyla sayar", () => {
    const kategori = { id: "k-alt", ad: "Yakıt", ust: { id: "k-ana", ad: "Araç Giderleri" } };
    const { kalemler, cevrilemeyen } = tahakkukSiniflandir(
      {
        ...bos,
        masraflar: [
          { id: "m1", belgeNo: null, tarih: g("2026-09-03"), matrah: 100, kur: 1, dovizCinsi: "TRY", aciklama: null, saticiUnvan: "Akaryakıt", kategori, cari: null },
          { id: "m2", belgeNo: null, tarih: g("2026-09-04"), matrah: 10, kur: 45, dovizCinsi: "EUR", aciklama: null, saticiUnvan: null, kategori, cari: null },
          // Kuru girilmemiş dövizli masraf: TL sanılıp sayılmamalı.
          { id: "m3", belgeNo: null, tarih: g("2026-09-04"), matrah: 10, kur: 1, dovizCinsi: "USD", aciklama: null, saticiUnvan: null, kategori, cari: null },
        ],
      },
    );
    expect(kalemler.find((k) => k.id === "m1")).toMatchObject({ anahtar: "masraf_kategori:k-alt", anaKategori: "Araç Giderleri", altKategori: "Yakıt", tutarTry: 100 });
    expect(kalemler.find((k) => k.id === "m2")?.tutarTry).toBe(450);
    expect(kalemler.some((k) => k.id === "m3")).toBe(false);
    expect(cevrilemeyen).toBe(1);
  });

  it("gelir kaydını brüt tutar ve kurla, bordroyu dönem sonunda net ödenecekle sayar", () => {
    const { kalemler } = tahakkukSiniflandir(
      {
        ...bos,
        gelirKayitlari: [{ id: "gk", belgeNo: null, tarih: g("2026-09-02"), brutTutar: 500, kur: 1, dovizCinsi: "TRY", aciklama: null, kategori: { id: "gk-k", ad: "Faiz Geliri", ust: null }, cari: null }],
        bordrolar: [{ id: "b1", donemYil: 2026, donemAy: 2, odenecekTutar: 30000, personel: { ad: "Ali", soyad: "Veli" } }],
      },
    );
    expect(kalemler.find((k) => k.id === "gk")).toMatchObject({ tur: "gelir", anahtar: "gelir_kategori:gk-k", anaKategori: "Faiz Geliri", tutarTry: 500 });
    expect(kalemler.find((k) => k.id === "b1")).toMatchObject({ tur: "gider", anahtar: "personel", tarih: "2026-02-28", tutarTry: 30000 });
  });

  it("kategori özetini ve toplamları kuruş hassasiyetinde çıkarır", () => {
    const { kalemler } = tahakkukSiniflandir(
      { ...bos, faturalar: Array.from({ length: 3 }, (_, i) => fatura({ id: `f${i}`, tip: "satis", toplamMatrah: 0.1 })) },
    );
    expect(toplam(kalemler, (k) => k.tur === "gelir")).toBe(0.3);
    expect(kategoriOzeti(kalemler, "gelir")).toEqual([{ anaKategori: "Esas Faaliyet Gelirleri", altKategori: "Satış Hasılatı", tutar: "0.30" }]);
  });
});
