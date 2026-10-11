import { describe, expect, it } from "vitest";
import { eksenOlcegi, grafikSvg, grafikVerisi, type GrafikVerisi } from "./rapor-grafik";

const kolonlar = [
  { alan: "grup", baslik: "Ay", tip: "metin" },
  { alan: "netSatis", baslik: "Net Satış (TL)", tip: "para" },
  { alan: "netAlis", baslik: "Net Alış (TL)", tip: "para" },
];
const SVG = { renkler: ["#2a78d6", "#eb6834", "#1baf7a"] as [string, string, string], metin: "#18202f", soluk: "#667085", izgara: "#e6e9ee", zemin: "#fff" };

describe("rapor grafiği (RPR-26)", () => {
  it("sütun: kategoriye göre toplar, sırayı korur", () => {
    const r = grafikVerisi({ tur: "sutun", kategori: "grup", seriler: ["netSatis", "netAlis"] }, kolonlar, [
      { grup: "2026-09", netSatis: 100, netAlis: 40 }, { grup: "2026-10", netSatis: 50, netAlis: 10 }, { grup: "2026-09", netSatis: 5, netAlis: 0 },
    ]);
    expect("veri" in r && r.veri).toMatchObject({ kategoriler: ["2026-09", "2026-10"], birim: "TL", seriler: [{ ad: "Net Satış (TL)", degerler: [105, 50] }, { ad: "Net Alış (TL)", degerler: [40, 10] }] });
  });

  it("yatay: büyükten küçüğe ilk N + Diğer", () => {
    const satirlar = Array.from({ length: 13 }, (_, i) => ({ unvan: `C${i}`, satis: i }));
    const r = grafikVerisi({ tur: "yatay", kategori: "unvan", seriler: ["satis"], enCok: 10 }, [{ alan: "unvan", baslik: "Ünvan", tip: "metin" }, { alan: "satis", baslik: "Satış", tip: "para" }], satirlar);
    if (!("veri" in r)) throw new Error("veri yok");
    expect(r.veri.kategoriler[0]).toBe("C12");
    expect(r.veri.kategoriler.at(-1)).toBe("Diğer (3)");
    expect(r.veri.seriler[0].degerler.at(-1)).toBe(0 + 1 + 2);
  });

  it("kategorisiz: seriler çubuk olur (yaşlandırma kovaları); karşılaştırma soluk seri", () => {
    const k = [{ alan: "g1", baslik: "0-30", tip: "para" }, { alan: "g2", baslik: "31-60", tip: "para" }, { alan: "g1__onceki", baslik: "x", tip: "para" }];
    const r = grafikVerisi({ tur: "yatay", seriler: ["g1", "g2"] }, k, [{ g1: 10, g2: 5, g1__onceki: 3 }, { g1: 1, g2: 0, g1__onceki: 1 }]);
    if (!("veri" in r)) throw new Error("veri yok");
    expect(r.veri.kategoriler).toEqual(["0-30", "31-60"]);
    expect(r.veri.seriler.map((s) => [s.soluk ?? false, s.degerler])).toEqual([[false, [11, 5]], [true, [4, 0]]]);
  });

  it("karışık döviz ve boş veri gerekçe döner; tek noktalı çizgi sütuna düşer", () => {
    const k = [{ alan: "grup", baslik: "Ay", tip: "metin" }, { alan: "giris", baslik: "Giriş", tip: "para", dovizAlani: "d" }];
    expect(grafikVerisi({ tur: "sutun", kategori: "grup", seriler: ["giris"] }, k, [{ grup: "a", giris: 1, d: "USD" }, { grup: "b", giris: 1, d: "TRY" }])).toHaveProperty("neden");
    expect(grafikVerisi({ tur: "sutun", kategori: "grup", seriler: ["giris"] }, k, [])).toHaveProperty("neden");
    const r = grafikVerisi({ tur: "cizgi", kategori: "grup", seriler: ["giris"] }, k, [{ grup: "a", giris: 1, d: "USD" }]);
    expect("veri" in r && r.veri.tur).toBe("sutun");
    expect("veri" in r && r.veri.birim).toBe("USD");
  });

  it("eksen ölçeği temiz adımlarla, eksi değerde sıfırı kapsar", () => {
    expect(eksenOlcegi(0, 9_300)).toEqual({ alt: 0, ust: 10_000, adim: 2_500 });
    expect(eksenOlcegi(-1_200, 3_000)).toMatchObject({ alt: -2_000, ust: 4_000 });
  });

  it("SVG: erişilebilir etiket, işaret başına title, ≥2 seride lejant, metin kaçışı", () => {
    const v: GrafikVerisi = { tur: "sutun", kategoriler: ["<A>", "B"], birim: "TL", seriler: [{ ad: "S1", renk: 1, degerler: [10, 20] }, { ad: "S2", renk: 2, degerler: [5, 0] }] };
    const svg = grafikSvg(v, { ...SVG, baslik: "Net satış" });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Net satış"');
    expect(svg).toContain("&lt;A&gt; · S1: 10,00 TL");
    expect(svg).toContain("grafik-lejant");
    expect(svg).not.toContain("<A>");
    expect(grafikSvg({ ...v, seriler: [v.seriler[0]] }, SVG)).not.toContain("grafik-lejant");
    expect(grafikSvg({ ...v, tur: "cizgi" }, SVG)).toContain("<polyline");
    expect(grafikSvg({ ...v, tur: "yatay" }, SVG)).toContain("<path");
  });
});
