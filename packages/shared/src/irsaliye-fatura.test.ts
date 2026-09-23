import { describe, expect, it } from "vitest";
import { irsaliyeFaturaFarklari, irsaliyeFaturaTipiUyarMi } from "./irsaliye-fatura";

const satir = (stokId: string, miktar: number, birim = "adet", ek: { varyantId?: string; stokTipi?: string } = {}) => ({ stokId, ad: stokId.toUpperCase(), miktar, birim, ...ek });

describe("irsaliyeFaturaTipiUyarMi (FTR-26)", () => {
  it("satış irsaliyesi satış, alış irsaliyesi alış faturasına bağlanır", () => {
    expect(irsaliyeFaturaTipiUyarMi("satis", "satis")).toBe(true);
    expect(irsaliyeFaturaTipiUyarMi("alis", "alis")).toBe(true);
  });

  it("çapraz yön, iade ve proforma bağlanmaz", () => {
    expect(irsaliyeFaturaTipiUyarMi("satis", "alis")).toBe(false);
    expect(irsaliyeFaturaTipiUyarMi("satis", "satis_iade")).toBe(false);
    expect(irsaliyeFaturaTipiUyarMi("alis", "alis_iade")).toBe(false);
    expect(irsaliyeFaturaTipiUyarMi("satis", "proforma")).toBe(false);
  });
});

describe("irsaliyeFaturaFarklari (FTR-26 madde 8)", () => {
  it("aynı kalem ve miktarda fark yok", () => {
    expect(irsaliyeFaturaFarklari([satir("a", 5)], [satir("a", 5)])).toEqual([]);
  });

  it("birden çok irsaliye satırı stok bazında toplanır", () => {
    expect(irsaliyeFaturaFarklari([satir("a", 2), satir("a", 3)], [satir("a", 5)])).toEqual([]);
  });

  it("miktar farkını söyler", () => {
    const farklar = irsaliyeFaturaFarklari([satir("a", 5)], [satir("a", 4)]);
    expect(farklar).toHaveLength(1);
    expect(farklar[0]).toMatchObject({ tur: "miktar" });
    expect(farklar[0].mesaj).toContain("irsaliyede 5 adet, faturada 4 adet");
  });

  it("yuvarlama farkını fark saymaz", () => {
    expect(irsaliyeFaturaFarklari([satir("a", 1.0004)], [satir("a", 1)])).toEqual([]);
  });

  it("yalnız bir tarafta olan kalemleri söyler", () => {
    const turler = irsaliyeFaturaFarklari([satir("a", 1)], [satir("b", 1)]).map((f) => f.tur);
    expect(turler).toEqual(["yalniz_irsaliyede", "yalniz_faturada"]);
  });

  it("varyantlar ayrı kalemdir", () => {
    const turler = irsaliyeFaturaFarklari([satir("a", 1, "adet", { varyantId: "k" })], [satir("a", 1, "adet", { varyantId: "m" })]).map((f) => f.tur);
    expect(turler).toEqual(["yalniz_irsaliyede", "yalniz_faturada"]);
  });

  it("birimi farklı kalemin miktarını karşılaştırmaz", () => {
    const farklar = irsaliyeFaturaFarklari([satir("a", 5, "koli")], [satir("a", 60, "adet")]);
    expect(farklar.map((f) => f.tur)).toEqual(["birim"]);
  });

  it("hizmet satırları karşılaştırmaya girmez", () => {
    expect(irsaliyeFaturaFarklari([satir("a", 1)], [satir("a", 1), satir("nakliye", 1, "adet", { stokTipi: "hizmet" })])).toEqual([]);
  });
});
