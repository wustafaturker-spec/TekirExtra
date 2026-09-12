import { describe, expect, it } from "vitest";
import { bosAylar, karsilastir, yillikDagit, type GerceklesenKalem, type KalemTanimi } from "./butce.hesap";

const tanimlar: KalemTanimi[] = [
  { anahtar: "satis:ticari_satis", tur: "gelir", anaKategori: "Esas Faaliyet Gelirleri", altKategori: "Satış Hasılatı" },
  { anahtar: "masraf_kategori:k1", tur: "gider", anaKategori: "Ofis", altKategori: "Kira" },
];
const aylik = (kurus: number) => bosAylar().map(() => kurus);
const gercek = (anahtar: string, tarih: string, tutarTry: number): GerceklesenKalem => ({ ...tanimlar.find((t) => t.anahtar === anahtar)!, tarih, tutarTry });

describe("yillikDagit (BUT-08)", () => {
  it("yıllık tutarı 12 aya böler, kuruş farkını son aya ekler", () => {
    const aylar = yillikDagit(100_000); // 1.000,00 TL
    expect(aylar.slice(0, 11).every((a) => a === 8333)).toBe(true);
    expect(aylar[11]).toBe(8337);
    expect(aylar.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
});

describe("karsilastir (BUT-07)", () => {
  it("bu yıl için yalnız bugüne kadarki ayların planını gerçekleşenle karşılaştırır", () => {
    const { satirlar } = karsilastir({
      tanimlar,
      plan: new Map([["masraf_kategori:k1", aylik(100_000)]]), // ayda 1.000 TL
      ilkPlan: null,
      gerceklesen: [gercek("masraf_kategori:k1", "2026-01-10", 1200), gercek("masraf_kategori:k1", "2026-02-10", 1100), gercek("masraf_kategori:k1", "2026-04-10", 999)],
      sonAy: 3,
    });
    const kira = satirlar[0];

    expect(kira.toplam).toMatchObject({ plan: 12000, planBugune: 3000, gerceklesen: 2300, fark: -700, oran: 76.7, durum: "uygun" });
    // Nisan karşılaştırma dışı: gerçekleşen boş, toplama girmez.
    expect(kira.aylar[3]).toEqual({ ay: 4, plan: 1000, ilkPlan: 0, gerceklesen: null });
  });

  it("giderde aşımı, gelirde eksik kalmayı, plansız gerçekleşeni ayrı işaretler", () => {
    const { satirlar, toplamlar } = karsilastir({
      tanimlar,
      plan: new Map([["satis:ticari_satis", aylik(500_000)], ["masraf_kategori:k1", aylik(100_000)]]),
      ilkPlan: null,
      gerceklesen: [gercek("satis:ticari_satis", "2026-01-05", 4000), gercek("masraf_kategori:k1", "2026-01-05", 1500)],
      sonAy: 1,
    });
    expect(satirlar.find((s) => s.tur === "gelir")?.toplam.durum).toBe("eksik");
    expect(satirlar.find((s) => s.tur === "gider")?.toplam.durum).toBe("asim");
    expect(toplamlar.net).toMatchObject({ planBugune: 4000, gerceklesen: 2500 });

    const plansiz = karsilastir({ tanimlar, plan: new Map(), ilkPlan: null, gerceklesen: [gercek("masraf_kategori:k1", "2026-01-05", 10)], sonAy: 1 });
    expect(plansiz.satirlar[0].toplam.durum).toBe("plansiz");
  });

  it("ilk onaylı planı geçerli planın yanında gösterir ve bilinmeyen kalemi gerçekleşenden adlandırır", () => {
    const { satirlar } = karsilastir({
      tanimlar,
      plan: new Map([["masraf_kategori:k1", aylik(150_000)]]),
      ilkPlan: new Map([["masraf_kategori:k1", aylik(100_000)]]),
      gerceklesen: [{ anahtar: "masraf_kategori:silinmis", tur: "gider", anaKategori: "Eski", altKategori: "Kategori", tarih: "2026-01-01", tutarTry: 5 }],
      sonAy: 12,
    });
    expect(satirlar.find((s) => s.anahtar === "masraf_kategori:k1")?.toplam).toMatchObject({ plan: 18000, ilkPlan: 12000 });
    expect(satirlar.find((s) => s.anahtar === "masraf_kategori:silinmis")).toMatchObject({ anaKategori: "Eski", toplam: { durum: "plansiz" } });
  });

  it("gelecek yılda gerçekleşen yoktur", () => {
    const { satirlar } = karsilastir({ tanimlar, plan: new Map([["satis:ticari_satis", aylik(1)]]), ilkPlan: null, gerceklesen: [], sonAy: 0 });
    expect(satirlar[0].aylar.every((a) => a.gerceklesen === null)).toBe(true);
    expect(satirlar[0].toplam).toMatchObject({ planBugune: 0, gerceklesen: 0, oran: null });
  });
});
