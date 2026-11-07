import { afterEach, describe, expect, it, vi } from "vitest";
import { hbKaydiOku, hbKayitTipi, hbKesintisi, hbOdemeDonemleri, HbYanitHatasi } from "./hepsiburada-finans";
import { HepsiburadaAdapter, hbKullaniciAjani } from "./hepsiburada.adapter";

const kayit = (ek: Record<string, unknown>) => ({ Id: "r1", TransactionType: "Commission", Amount: 125.4, IsIncome: false, IsInvoice: true, CurrencyCode: 949, OrderNumber: "0019531668", PackageNumber: "P1", ReferenceDocument: "HD12018000104453", Status: "WillBePaid", RecordDate: "2026-10-05T10:00:00", ...ek });

describe("Hepsiburada muhasebe kayıtları (PZR-21)", () => {
  it("komisyon gider → artı faturalı kesinti; alan adları büyük/küçük harf duyarsız", () => {
    const k = hbKesintisi(hbKaydiOku(kayit({})))!;
    expect(k).toMatchObject({ hariciId: "hb:r1", tur: "Komisyon", sinif: "faturali", tutar: 125.4, siparisNo: "0019531668", tarih: "2026-10-05", dovizCinsi: "TRY" });
    expect(k.aciklama).toBe("Commission · Belge HD12018000104453 · Paket P1");
    expect(hbKesintisi(hbKaydiOku({ id: "x", transactionType: "Commission", amount: 10, isIncome: false, recordDate: "2026-10-05" }))!.tutar).toBe(10);
  });

  it("işaret yalnız IsIncome'dan: gelir kaydı eksi, tutarın kendi işareti dikkate alınmaz", () => {
    expect(hbKesintisi(hbKaydiOku(kayit({ TransactionType: "CommissionRefund", Amount: -40, IsIncome: true })))!.tutar).toBe(-40);
    expect(hbKesintisi(hbKaydiOku(kayit({ TransactionType: "StoppageRefund", Amount: 5, IsIncome: true })))).toMatchObject({ sinif: "stopaj", tutar: -5 });
    expect(hbKesintisi(hbKaydiOku(kayit({ TransactionType: "Stoppage", Amount: -5, IsIncome: false })))).toMatchObject({ tur: "E-ticaret stopajı", sinif: "stopaj", tutar: 5 });
  });

  it("sipariş tutarı kayıtları kesinti olmaz; satıcının kestiği fatura ve bilinmeyen tip sınıflandırılmamış", () => {
    for (const t of ["Payment", "Return", "BnplOrder", "BnplRefund"]) expect(hbKesintisi(hbKaydiOku(kayit({ TransactionType: t, IsIncome: true })))).toBeNull();
    expect(hbKayitTipi("CampaignDiscount").sinif).toBe("siniflandirilmamis");
    expect(hbKayitTipi("YeniTip")).toEqual({ ad: "Hepsiburada: YeniTip", sinif: "siniflandirilmamis" });
    // Belgede açıklaması yer değiştirmiş tipler kod adına göre adlandırılır.
    expect(hbKayitTipi("BnplProcessingFee").ad).toBe("BNPL işlem ücreti");
    expect(hbKayitTipi("BnplProcessingFeeRefund").ad).toBe("BNPL işlem ücreti iadesi");
  });

  it("kimlik yoksa içerikten kararlı özet; döviz 840 USD", () => {
    const a = hbKaydiOku(kayit({ Id: undefined, CurrencyCode: 840 }));
    const b = hbKaydiOku(kayit({ Id: undefined, CurrencyCode: 840 }));
    expect(a.kimlik).toHaveLength(32);
    expect(a.kimlik).toBe(b.kimlik);
    expect(a.doviz).toBe("USD");
  });

  it("tutar, tip ya da tarih tanınmazsa ham örnekle durur", () => {
    expect(() => hbKaydiOku({ TransactionType: "Commission", Tutar: 5, RecordDate: "2026-10-05" })).toThrow(HbYanitHatasi);
    expect(() => hbKaydiOku({ TransactionType: "Commission", Amount: 5 })).toThrow(/tarih alanı/);
  });

  it("ödenmiş kayıtlar ödeme günü ve dövize göre dönem olur; tutar satıcı açısından net", () => {
    const k = [
      kayit({ Id: "1", TransactionType: "Payment", Amount: 1000, IsIncome: true, Status: "Paid", PaymentDate: "2026-10-15" }),
      kayit({ Id: "2", TransactionType: "Commission", Amount: 150, IsIncome: false, Status: "Paid", PaymentDate: "2026-10-15" }),
      kayit({ Id: "3", TransactionType: "CommissionRefund", Amount: 20, IsIncome: true, Status: "Paid", PaymentDate: "2026-10-15" }),
      kayit({ Id: "4", TransactionType: "Commission", Amount: 99, IsIncome: false, Status: "WillBePaid" }),
    ].map(hbKaydiOku);
    expect(hbOdemeDonemleri(k)).toEqual([{ odemeNo: "HB-2026-10-15", odemeGunu: "2026-10-15", doviz: "TRY", tutar: 870, kayitSayisi: 3 }]);
    expect(hbKesintisi(k[1])!.odemeNo).toBe("HB-2026-10-15");
    expect(hbKesintisi(k[3])!.odemeNo).toBeUndefined();
  });
});

describe("Hepsiburada finans çekimi (PZR-21)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { kullaniciAdi: "kullanici", parola: "anahtar", magazaId: "M1", entegratorAdi: "tekirextra_dev" };

  it("User-Agent entegratör adıdır; offset/limit sayfalı, canlı adres ve kayıt tarihi aralığı", async () => {
    const istekler: { url: URL; ua: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL, init: RequestInit) => {
      const url = new URL(u); istekler.push({ url, ua: new Headers(init.headers).get("user-agent") });
      const offset = Number(url.searchParams.get("offset"));
      return Response.json({ items: offset === 0 ? Array.from({ length: 100 }, (_, i) => kayit({ Id: `a${i}` })) : [kayit({ Id: "son" })] });
    }));
    const r = await new HepsiburadaAdapter(0).finansKayitlariCek(config, "record", "2026-10-01", "2026-10-15");
    expect(r.kayitlar).toHaveLength(101);
    expect(istekler.map((i) => i.url.searchParams.get("offset"))).toEqual(["0", "100"]);
    expect(istekler[0].url.origin + istekler[0].url.pathname).toBe("https://mpfinance-external.hepsiburada.com/transactions/merchantid/M1");
    expect(istekler[0].url.searchParams.get("recordDateStart")).toBe("2026-10-01");
    expect(istekler[0].url.searchParams.get("limit")).toBe("100");
    expect(istekler[0].ua).toBe("tekirextra_dev");
    expect(hbKullaniciAjani({ kullaniciAdi: "x" })).toBe("TekirExtra/1.0");
  });

  it("test servis adresi -sit içeriyorsa finans da test ortamına gider", async () => {
    const f = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", f);
    await new HepsiburadaAdapter(0).finansKayitlariCek({ ...config, servisAdresi: "https://oms-external-sit.hepsiburada.com" }, "payment", "2026-10-01", "2026-10-01");
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("mpfinance-external-sit.hepsiburada.com");
  });

  it("409 (çok döviz) aralığı ikiye böler; tek günde sürerse hata", async () => {
    const araliklar: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      const url = new URL(u); const bas = url.searchParams.get("paymentDateStart")!; const son = url.searchParams.get("paymentDateEnd")!;
      araliklar.push(`${bas}..${son}`);
      return bas === son ? Response.json([kayit({ Id: bas })]) : new Response("{}", { status: 409 });
    }));
    const r = await new HepsiburadaAdapter(0).finansKayitlariCek(config, "payment", "2026-10-01", "2026-10-02");
    expect(r.kayitlar.map((k) => k.kimlik)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(araliklar).toEqual(["2026-10-01..2026-10-02", "2026-10-01..2026-10-01", "2026-10-02..2026-10-02"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    await expect(new HepsiburadaAdapter(0).finansKayitlariCek(config, "payment", "2026-10-01", "2026-10-01")).rejects.toThrow("birden çok dövizde");
  });

  it("liste tanınmazsa ham örnekle durur; 401 kimlik hatası olarak yükselir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ sonuc: "x" })));
    await expect(new HepsiburadaAdapter(0).finansKayitlariCek(config, "record", "2026-10-01", "2026-10-01")).rejects.toThrow(/kayıt listesi tanınamadı.*sonuc/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(new HepsiburadaAdapter(0).finansKayitlariCek(config, "record", "2026-10-01", "2026-10-01")).rejects.toThrow("HTTP 401");
  });
});
