import { afterEach, describe, expect, it, vi } from "vitest";
import { cekimPencereleri, digerFinansKesintisi, istanbulGunu, PENCERE_MS, settlementKesintileri } from "./trendyol-finans";
import { TrendyolAdapter } from "./trendyol.adapter";
import { eslesmeOnerisi } from "./pazaryeri-eslestirme";

// Belgedeki örnek kayda benzer (developers.trendyol.com, Cari Hesap Ekstresi Entegrasyonu).
const satis = { id: "725041340", transactionDate: Date.UTC(2026, 9, 5, 21, 30), transactionType: "Satış", description: "Satış", debt: 0, credit: 1000, commissionRate: 15, commissionAmount: 150, sellerRevenue: 850, orderNumber: "10293847", paymentOrderId: 991 };

describe("Trendyol finans kayıtlarından kesinti (PZR-15)", () => {
  it("satış komisyonu artı, iade komisyonu eksi; işaret alan değerinden değil türden gelir", () => {
    const [k] = settlementKesintileri("Sale", satis);
    expect(k).toMatchObject({ hariciId: "ty:s:725041340:komisyon", tur: "Komisyon", tutar: 150, siparisNo: "10293847", dovizCinsi: "TRY" });
    // İstanbul saatiyle 6 Ekim (UTC 5 Ekim 21:30)
    expect(k.tarih).toBe("2026-10-06");
    const [iade] = settlementKesintileri("Return", { ...satis, id: 2, commissionAmount: -150 });
    expect(iade).toMatchObject({ tur: "Komisyon iadesi", tutar: -150 });
  });

  it("komisyon düzeltmeleri ve iptalleri belgedeki yönle", () => {
    expect(settlementKesintileri("CommissionNegative", { ...satis, commissionAmount: 20, sellerRevenue: 0 })[0].tutar).toBe(20);
    expect(settlementKesintileri("CommissionPositive", { ...satis, commissionAmount: 20, sellerRevenue: 0 })[0].tutar).toBe(-20);
    expect(settlementKesintileri("CommissionNegativeCancel", { ...satis, commissionAmount: 20, sellerRevenue: 0 })[0].tutar).toBe(-20);
  });

  it("hakediş düzeltmesi: satıcı geliri lehine eksi; provizyonda komisyon ayrı, düzeltme brüt", () => {
    expect(settlementKesintileri("SellerRevenuePositive", { ...satis, commissionAmount: 0, sellerRevenue: 40 })).toEqual([expect.objectContaining({ hariciId: "ty:s:725041340:duzeltme", tur: "Hakediş düzeltmesi", tutar: -40 })]);
    expect(settlementKesintileri("SellerRevenueNegative", { ...satis, commissionAmount: 0, sellerRevenue: 40 })[0].tutar).toBe(40);
    const prov = settlementKesintileri("ProvisionPositive", { ...satis, commissionAmount: 15, sellerRevenue: 85 });
    // Ödemeye etkisi: −(15 − 100) = +85 = satıcı geliri
    expect(prov.map((k) => k.tutar)).toEqual([15, -100]);
  });

  it("komisyonu sıfır satış kesinti üretmez", () => {
    expect(settlementKesintileri("Sale", { ...satis, commissionAmount: 0 })).toEqual([]);
  });

  it("stopaj borçta artı, iptali alacakta eksi; hizmet faturası Trendyol etiketiyle", () => {
    expect(digerFinansKesintisi("Stoppage", { id: 7, transactionDate: satis.transactionDate, transactionType: "E-ticaret Stopajı", debt: 10, credit: 0 })).toMatchObject({ hariciId: "ty:o:7:stopaj", tur: "E-ticaret stopajı", tutar: 10 });
    expect(digerFinansKesintisi("Stoppage", { id: 8, transactionDate: satis.transactionDate, transactionType: "E-ticaret Stopaj İptali", debt: 0, credit: 10 })?.tutar).toBe(-10);
    expect(digerFinansKesintisi("DeductionInvoices", { id: "DDF2026000000123", transactionDate: satis.transactionDate, transactionType: "Kargo Faturası", debt: 345.6, credit: 0 })).toMatchObject({ tur: "Kargo Faturası", tutar: 345.6, aciklama: "Kargo Faturası · Belge DDF2026000000123" });
    expect(digerFinansKesintisi("DeductionInvoices", { id: 9, debt: 0, credit: 0 })).toBeNull();
  });

  it("pencereler 15 günü aşmaz; ilk çekim 90 gün, sonrakiler son bitişten 15 gün geri", () => {
    const simdi = Date.UTC(2026, 10, 7);
    const ilk = cekimPencereleri(null, simdi);
    expect(ilk[0].baslangic).toBe(simdi - 90 * 86_400_000);
    expect(ilk.at(-1)!.bitis).toBeGreaterThanOrEqual(simdi - 1);
    expect(ilk.every((p) => p.bitis - p.baslangic < PENCERE_MS)).toBe(true);
    expect(ilk.every((p, i) => i === 0 || p.baslangic === ilk[i - 1].bitis + 1)).toBe(true);
    const sonraki = cekimPencereleri(simdi - 86_400_000, simdi);
    expect(sonraki[0].baslangic).toBe(simdi - 86_400_000 - PENCERE_MS);
    expect(sonraki.length).toBe(2);
  });

  it("istanbulGunu gün sınırında İstanbul saatini kullanır", () => {
    expect(istanbulGunu(Date.UTC(2026, 0, 1, 20, 59))).toBe("2026-01-01");
    expect(istanbulGunu(Date.UTC(2026, 0, 1, 21, 0))).toBe("2026-01-02");
  });
});

describe("Trendyol finans çekimi (PZR-15)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("her türü ayrı, sayfalı sorgular; 429'da yeniden dener", async () => {
    const istekler: URL[] = [];
    let ilk429 = true;
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      const url = new URL(u); istekler.push(url);
      const tur = url.searchParams.get("transactionType");
      if (tur === "Sale" && ilk429) { ilk429 = false; return new Response("", { status: 429, headers: { "retry-after": "1" } }); }
      if (tur === "Sale") {
        const sayfa = Number(url.searchParams.get("page"));
        return Response.json({ totalPages: 2, content: [{ ...satis, id: `s${sayfa}` }] });
      }
      if (tur === "Stoppage") return Response.json({ totalPages: 1, content: [{ id: "st1", transactionDate: satis.transactionDate, debt: 8.5, credit: 0 }] });
      return Response.json({ totalPages: 0, content: [] });
    }));
    const r = await new TrendyolAdapter(0).finansKesintileriCek({ kullaniciAdi: "k", parola: "p", saticiId: "123" }, 1, 2);
    expect(r.kesintiler.map((k) => [k.hariciId, k.tutar])).toEqual([["ty:s:s0:komisyon", 150], ["ty:s:s1:komisyon", 150], ["ty:o:st1:stopaj", 8.5]]);
    const sale = istekler.filter((u) => u.searchParams.get("transactionType") === "Sale");
    expect(sale.map((u) => u.searchParams.get("page"))).toEqual(["0", "0", "1"]);
    expect(sale[0].pathname).toBe("/integration/finance/che/sellers/123/settlements");
    expect(sale[0].searchParams.get("size")).toBe("1000");
    expect(istekler.find((u) => u.searchParams.get("transactionType") === "Stoppage")!.pathname).toContain("/otherfinancials");
    expect(istekler.some((u) => ["PaymentOrder", "Discount"].includes(u.searchParams.get("transactionType") ?? "") && u.pathname.includes("otherfinancials"))).toBe(false);
  });

  it("kalıcı hata çekimi durdurur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(new TrendyolAdapter(0).finansKesintileriCek({ kullaniciAdi: "k", parola: "p", saticiId: "123" }, 1, 2)).rejects.toThrow("HTTP 401");
  });
});

describe("eşleştirme önerisi eksi kesintiyle (PZR-15)", () => {
  it("iade komisyonu dilim toplamını aştıktan sonra düşürebilir", () => {
    const g = (d: number) => new Date(Date.UTC(2026, 9, d));
    const r = eslesmeOnerisi({ tarih: g(30), toplam: "250" }, [
      { id: "a", tarih: g(1), tutar: "300" }, { id: "b", tarih: g(2), tutar: "-100" }, { id: "c", tarih: g(3), tutar: "50" },
    ]);
    expect(r).toEqual({ kesintiIds: ["a", "b", "c"], toplam: "250.00" });
  });
});
