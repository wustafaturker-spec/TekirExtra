import { describe, expect, it } from "vitest";
import { ILLER, ilBul, ilceGecerliMi, ilceleriGetir, tekVergiDairesi, vergiDaireleriniSirala } from "./il-ilce";

const d = (kod: string, ilKodu: string, il: string, ilce: string, ad: string) => ({ kod, ilKodu, il, ilce, ad });
const DAIRELER = [
  d("34250", "34", "İstanbul", "Merkez", "Kadıköy Vergi Dairesi Müdürlüğü"),
  d("34251", "34", "İstanbul", "Merkez", "Göztepe Vergi Dairesi Müdürlüğü"),
  d("34252", "34", "İstanbul", "Merkez", "Beşiktaş Vergi Dairesi Müdürlüğü"),
  d("34201", "34", "İstanbul", "Adalar", "Adalar Vergi Dairesi Müdürlüğü"),
  d("04201", "04", "Ağrı", "Doğubeyazıt", "Doğubeyazıt Vergi Dairesi Müdürlüğü"),
];

describe("il / ilçe listesi", () => {
  it("81 il ve 973 ilçe içerir; İstanbul'un 39 ilçesi tamdır", () => {
    expect(ILLER).toHaveLength(81);
    expect(ILLER.reduce((t, i) => t + i.ilceler.length, 0)).toBe(973);
    expect(ilceleriGetir("34")).toHaveLength(39);
    expect(ilceleriGetir("İstanbul")).toEqual(expect.arrayContaining(["Kadıköy", "Beşiktaş", "Üsküdar", "Şişli"]));
  });

  it("il koduyla ya da adıyla bulunur, ilçe harf duyarsız doğrulanır", () => {
    expect(ilBul("6")?.ad).toBe("Ankara");
    expect(ilBul("izmir")?.kod).toBe("35");
    expect(ilceGecerliMi("İstanbul", "kadıköy")).toBe(true);
    expect(ilceGecerliMi("Ankara", "Kadıköy")).toBe(false);
    expect(ilceGecerliMi("İstanbul", "")).toBe(false);
  });

  it("vergi dairesi il içinden seçilir; ilçeye yakın olanlar öne gelir", () => {
    const { yakin, diger } = vergiDaireleriniSirala(DAIRELER, "34", "Kadıköy");
    expect(yakin.map((x) => x.kod)).toEqual(["34250"]);
    expect(diger.map((x) => x.kod)).toEqual(["34201", "34252", "34251"]);
    expect(vergiDaireleriniSirala(DAIRELER, "34", "").diger).toHaveLength(4);
  });

  it("ilçede tek daire varsa kendiliğinden seçilir; GİB'in eski ilçe yazımı eşlenir", () => {
    expect(tekVergiDairesi(DAIRELER, "34", "Adalar")?.kod).toBe("34201");
    expect(tekVergiDairesi(DAIRELER, "34", "Kadıköy")).toBeUndefined();
    expect(tekVergiDairesi(DAIRELER, "04", "Doğubayazıt")?.kod).toBe("04201");
  });
});
