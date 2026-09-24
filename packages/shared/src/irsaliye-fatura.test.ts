import { describe, expect, it } from "vitest";
import { eirsaliyeIptalUyarisi, faturaGecikmeUyarilari, irsaliyeIptalUyarisi, gumrukSeferNotu, ihracatFaturasiNotu, irsaliyeFaturaFarklari, irsaliyeKanali, irsaliyeFaturaSonGun, irsaliyeFaturaSuresi, irsaliyeFaturaTipiUyarMi, irsaliyeSevkGunu } from "./irsaliye-fatura";

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
  it("e-İrsaliye kullanıcısı firmada her irsaliye e-İrsaliyedir, değilse kâğıttır", () => {
    expect(irsaliyeKanali(true)).toEqual({ kanal: "eirsaliye" });
    expect(irsaliyeKanali(false)).toEqual({ kanal: "kagit" });
  });

  it("firmanın kapsamı bilinmiyorsa karar vermez", () => {
    expect(irsaliyeKanali(null)).toHaveProperty("hata");
  });
});

it("numarasız irsaliyenin gecikme uyarısı numara uydurmaz (EBLG-83)", () => {
  const [uyari] = faturaGecikmeUyarilari({ faturaTarihi: "2026-09-20", yon: "satis", irsaliyeler: [{ no: null, sevkGunu: "2026-09-01" }] });
  expect(uyari).toContain("numarasız irsaliyenin");
});

it("gümrükten depoya sevkin açıklamasını müşavirin verdiği kalıpla yazar (EBLG-87)", () => {
  expect(gumrukSeferNotu({ beyannameNo: "26341300IM000123", beyannameTarihi: "2026-09-20", seferNo: 2 }))
    .toBe("20.09.2026 Tarih ve 26341300IM000123 Sayılı Gümrük Beyannamesi muhteviyatı malların gümrükten depoya kısım kısım taşınmasına ilişkin 2. seferidir.");
});

it("ihracat irsaliyesinin açıklamasına bağlı faturayı yazar (EBLG-89)", () => {
  expect(ihracatFaturasiNotu({ faturaNo: "K072026000000090", faturaTarihi: "2026-09-23T00:00:00.000Z" }))
    .toBe("Bu irsaliye 23.09.2026 tarih ve K072026000000090 numaralı ihracat faturasına istinaden düzenlenmiştir.");
});

describe("eirsaliyeIptalUyarisi (EBLG-90)", () => {
  it("GİB'e ulaşmış belgede alıcıya göre uyarır", () => {
    expect(eirsaliyeIptalUyarisi({ durum: "iletildi", aliciKayitsiz: false })).toContain("RET yanıtı");
    expect(eirsaliyeIptalUyarisi({ durum: "kabul", aliciKayitsiz: true })).toContain("KEP");
  });

  it("gönderilmemiş, GİB'e ulaşmamış ya da reddedilmiş belgede uyarmaz", () => {
    expect(eirsaliyeIptalUyarisi(null)).toBeNull();
    expect(eirsaliyeIptalUyarisi({ durum: "hata" })).toBeNull();
    expect(eirsaliyeIptalUyarisi({ durum: "ret" })).toBeNull();
  });
});

describe("irsaliyeIptalUyarisi (EBLG-92)", () => {
  const b = { tur: "irsaliye", yon: "satis", no: "GBZ2026000800002", kagitIrsaliye: false };
  it("numara almış ama GİB'e ulaşmamış belgede boşluğu uyarır", () => {
    expect(irsaliyeIptalUyarisi({ ...b, eirsaliye: null })).toContain("GBZ2026000800002 numarası");
    expect(irsaliyeIptalUyarisi({ ...b, eirsaliye: { durum: "hata" } })).toContain("dilekçe");
  });
  it("GİB'e ulaşmış belgede EBLG-90 uyarısını verir", () => {
    expect(irsaliyeIptalUyarisi({ ...b, eirsaliye: { durum: "iletildi" } })).toContain("RET yanıtı");
  });
  it("numarasız, iç serili, kâğıt ya da reddedilmiş belgede uyarmaz", () => {
    expect(irsaliyeIptalUyarisi({ ...b, no: null })).toBeNull();
    expect(irsaliyeIptalUyarisi({ ...b, yon: "alis", no: "AIR2026000001" })).toBeNull();
    expect(irsaliyeIptalUyarisi({ ...b, kagitIrsaliye: true, no: "KIR2026000001" })).toBeNull();
    expect(irsaliyeIptalUyarisi({ ...b, eirsaliye: { durum: "ret" } })).toBeNull();
  });
  it("gümrükten depoya sevk de giden seridir", () => {
    expect(irsaliyeIptalUyarisi({ ...b, yon: "alis", gumrukDepoSevki: true })).toContain("boşluk");
  });
});
