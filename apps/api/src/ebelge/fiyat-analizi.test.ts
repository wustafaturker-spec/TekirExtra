import { describe, expect, it } from "vitest";
import { belgeNetMatrahlari, fiyatKarsilastir, yilOnce, type FiyatGozlemi } from "./fiyat-analizi";
import { gelenFiyatAnaliziSemasi } from "./ebelge.semalar";
const gozlem = (g: Partial<FiyatGozlemi> = {}): FiyatGozlemi => ({ faturaId: "f1", no: "AL1", tarih: "2026-09-01",
  cariId: "c1", unvan: "Tedarikçi 1", miktar: "10", matrah: "1000", birim: "adet", doviz: "TRY", ...g });
const analiz = (gecmis: FiyatGozlemi[], g = {}) => fiyatKarsilastir({ tarih: "2026-10-14", miktar: "10",
  matrah: "1200", cariId: "c1", birim: "adet", doviz: "TRY", kesildi: false, gecmis, ...g });
describe("Gelen fatura fiyat analizi", () => {
  it("net fiyat ve aynı tedarikçi farkını hesaplar, en ucuz diğer tedarikçiyi gösterir", () => {
    const a = analiz([gozlem(), gozlem({ cariId: "c2", faturaId: "f2", matrah: "800" })]);
    expect(a.netBirimFiyat).toBe("120.000000"); expect(a.sonAlis?.farkYuzde).toBe("20.00");
    expect(a.tedarikciler.map((g) => g.cariId)).toEqual(["c2", "c1"]);
    expect(a.tedarikciler[0].farkYuzde).toBe("50.00");
    expect(a.tedarikciler[0].enDusugeGoreFarkYuzde).toBe("0.00");
    expect(a.tedarikciler[1].enDusugeGoreFarkYuzde).toBe("25.00");
  });
  it("aynı tedarikçinin yalnız son faturasını seçer, aynı fatura satırlarını ağırlıklandırır", () => {
    const a = analiz([gozlem(), gozlem({ miktar: "30", matrah: "2400" }),
      gozlem({ tarih: "2026-08-01", faturaId: "eski", matrah: "100" })]);
    expect(a.tedarikciler).toHaveLength(1);
    expect(a.tedarikciler[0].netBirimFiyat).toBe("85.000000");
    expect(a.sonAlis?.netBirimFiyat).toBe("85.000000");
  });
  it("90 günden eski tedarikçi fiyatını güncel listede göstermez", () => {
    const a = analiz([gozlem({ tarih: "2026-06-01" })]);
    expect(a.tedarikciler).toEqual([]); expect(a.sonAlis).not.toBeNull();
  });
  it("farklı birim, döviz, sıfır miktar, bedelsiz ve gelecekteki alışı dışlar", () => {
    const a = analiz([gozlem({ birim: "koli" }), gozlem({ doviz: "USD" }), gozlem({ miktar: "0" }),
      gozlem({ matrah: "0" }), gozlem({ tarih: "2026-10-14" }), gozlem({ tarih: "2027-01-01" })]);
    expect(a.sonAlis).toBeNull(); expect(a.tedarikciler).toEqual([]); expect(a.yillik.artisYuzde).toBeNull();
  });
  it("aynı birimin bilinen eşanlamını kabul eder", () => {
    expect(analiz([gozlem({ birim: "tane" })]).sonAlis).not.toBeNull();
  });
  it("yıllık ortalamayı miktar ağırlıklı hesaplar, takvim yıllarını karıştırmaz", () => {
    const a = analiz([gozlem({ tarih: "2025-01-01", matrah: "1000" }),
      gozlem({ tarih: "2025-09-01", miktar: "30", matrah: "2400" }),
      gozlem({ tarih: "2025-10-14", matrah: "1020" }), gozlem({ tarih: "2026-09-01", matrah: "1020" })]);
    expect(a.yillik.onceki.ortalama).toBe("85.000000");
    expect(a.yillik.son.ortalama).toBe("102.000000"); expect(a.yillik.artisYuzde).toBe("20.00");
    expect(a.tedarikciYillik?.artisYuzde).toBe("20.00");
  });
  it("eksik yıl veya kesilmiş geçmiş için yıllık artış uydurmaz", () => {
    expect(analiz([gozlem()]).yillik.artisYuzde).toBeNull();
    expect(analiz([gozlem(), gozlem({ tarih: "2025-01-01" })], { kesildi: true }).yillik.artisYuzde).toBeNull();
  });
  it("aynı tedarikçi yıllık sonucunu diğerlerinden ayırır, fiyat düşüşünün işaretini korur", () => {
    const a = analiz([gozlem({ tarih: "2025-01-01", matrah: "2000" }), gozlem(),
      gozlem({ cariId: "c2", matrah: "5000" })]);
    expect(a.tedarikciYillik?.artisYuzde).toBe("-50.00");
    expect(a.yillik.artisYuzde).toBe("50.00");
  });
  it("eşleşmeyen cari için tedarikçi özel sonucu üretmez", () => {
    expect(analiz([gozlem()], { cariId: null }).tedarikciYillik).toBeNull();
  });
  it("belge iskontosunu kuruş farkıyla bir kez dağıtır", () => {
    expect(belgeNetMatrahlari([100, 200], 30)).toEqual(["90.00", "180.00"]);
    expect(belgeNetMatrahlari([1, 1, 1], 1)).toEqual(["0.67", "0.67", "0.66"]);
  });
  it("artık yıl sınırını doğru kullanır", () => { expect(yilOnce("2024-02-29")).toBe("2023-02-28"); });
  it("yinelenen ve fazladan parasal alan içeren istekleri reddeder", () => {
    const e = { siraNo: 1, stokId: "11111111-1111-4111-8111-111111111111" };
    expect(gelenFiyatAnaliziSemasi.safeParse({ satirEslesmeleri: [e, e] }).success).toBe(false);
    expect(gelenFiyatAnaliziSemasi.safeParse({ satirEslesmeleri: [e], fiyat: 1 }).success).toBe(false);
    expect(gelenFiyatAnaliziSemasi.safeParse({ satirEslesmeleri: [e] }).success).toBe(true);
  });
});
