import { describe, expect, it } from "vitest";
import { faturaGecikmeUyarilari, irsaliyeFaturaFarklari, irsaliyeKanali, irsaliyeFaturaSonGun, irsaliyeFaturaSuresi, irsaliyeFaturaTipiUyarMi, irsaliyeSevkGunu } from "./irsaliye-fatura";

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

describe("irsaliye faturalama süresi (EBLG-82)", () => {
  it("son gün teslim günü + 7'dir", () => {
    expect(irsaliyeFaturaSonGun("2026-09-01")).toBe("2026-09-08");
    expect(irsaliyeFaturaSonGun("2026-09-28")).toBe("2026-10-05");
    expect(irsaliyeFaturaSonGun("2026-09-01", 10)).toBe("2026-09-11");
  });

  it("teslim günü fiili sevk anından Türkiye saatiyle okunur, yoksa irsaliye tarihinden", () => {
    // 02:30 TR = önceki gün 23:30 UTC; gün yine de 15'i.
    expect(irsaliyeSevkGunu({ fiiliSevkZamani: "2026-09-14T23:30:00Z", tarih: new Date("2026-09-10T00:00:00Z") })).toBe("2026-09-15");
    expect(irsaliyeSevkGunu({ fiiliSevkZamani: null, tarih: new Date("2026-09-10T00:00:00Z") })).toBe("2026-09-10");
    expect(irsaliyeSevkGunu({ tarih: "2026-09-10" })).toBe("2026-09-10");
  });

  it("kalan günü, yaklaşmayı ve geçmeyi söyler", () => {
    expect(irsaliyeFaturaSuresi({ sevkGunu: "2026-09-01", bugun: "2026-09-03" })).toMatchObject({ sonGun: "2026-09-08", kalanGun: 5, gecti: false, yaklasiyor: false });
    expect(irsaliyeFaturaSuresi({ sevkGunu: "2026-09-01", bugun: "2026-09-06" })).toMatchObject({ kalanGun: 2, yaklasiyor: true });
    expect(irsaliyeFaturaSuresi({ sevkGunu: "2026-09-01", bugun: "2026-09-08" })).toMatchObject({ kalanGun: 0, gecti: false, yaklasiyor: true });
    expect(irsaliyeFaturaSuresi({ sevkGunu: "2026-09-01", bugun: "2026-09-10" })).toMatchObject({ kalanGun: -2, gecti: true, yaklasiyor: false });
  });

  it("süresinden sonra düzenlenen faturada uyarır, son günde uyarmaz", () => {
    const irsaliyeler = [{ no: "GBZ2026000000001", sevkGunu: "2026-09-01" }];
    expect(faturaGecikmeUyarilari({ faturaTarihi: "2026-09-08", yon: "satis", irsaliyeler })).toEqual([]);
    expect(faturaGecikmeUyarilari({ faturaTarihi: "2026-09-09", yon: "satis", irsaliyeler })[0]).toContain("son gün 08.09.2026");
    expect(faturaGecikmeUyarilari({ faturaTarihi: "2026-09-09", yon: "alis", irsaliyeler })[0]).toContain("Tedarikçi faturası");
  });
});

describe("irsaliyeKanali (EBLG-83)", () => {
  it("firma kullanıcı değilse alıcıya bakmadan kâğıttır", () => {
    expect(irsaliyeKanali({ firmaEirsaliye: false, aliciKayitli: null })).toEqual({ kanal: "kagit" });
  });

  it("firma ve alıcı kullanıcıysa e-İrsaliyedir, alıcı değilse kâğıttır", () => {
    expect(irsaliyeKanali({ firmaEirsaliye: true, aliciKayitli: true })).toEqual({ kanal: "eirsaliye" });
    expect(irsaliyeKanali({ firmaEirsaliye: true, aliciKayitli: false })).toEqual({ kanal: "kagit" });
  });

  it("firma kapsamı ya da alıcının kaydı bilinmiyorsa karar vermez", () => {
    expect(irsaliyeKanali({ firmaEirsaliye: null, aliciKayitli: true })).toHaveProperty("hata");
    expect(irsaliyeKanali({ firmaEirsaliye: true, aliciKayitli: null })).toHaveProperty("hata");
  });
});

it("numarasız irsaliyenin gecikme uyarısı numara uydurmaz (EBLG-83)", () => {
  const [uyari] = faturaGecikmeUyarilari({ faturaTarihi: "2026-09-20", yon: "satis", irsaliyeler: [{ no: null, sevkGunu: "2026-09-01" }] });
  expect(uyari).toContain("numarasız irsaliyenin");
});
