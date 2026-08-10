import { afterEach, describe, expect, it, vi } from "vitest";
import { HepsiburadaAdapter } from "./hepsiburada.adapter";

afterEach(() => vi.unstubAllGlobals());

describe("HepsiburadaAdapter", () => {
  it("kalem bazli kayitlari siparis numarasina gore gruplar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ([
      { id: "l1", orderNumber: "HB-42", orderDate: "2026-08-10T10:00:00Z", customerName: "Ada Yılmaz", merchantSku: "SKU-1", productName: "Ürün 1", quantity: 1, unitPrice: { amount: 100 }, vatRate: 20 },
      { id: "l2", orderNumber: "HB-42", orderDate: "2026-08-10T10:00:00Z", customerName: "Ada Yılmaz", merchantSku: "SKU-2", productName: "Ürün 2", quantity: 2, unitPrice: { amount: 50 }, vatRate: 10 },
    ]) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new HepsiburadaAdapter().siparisleriCek({ kullaniciAdi: "user", parola: "pass", magazaId: "merchant-1" });
    expect(sonuc.siparisler).toHaveLength(1);
    expect(sonuc.siparisler[0]).toEqual(expect.objectContaining({ siparisNo: "HB-42", toplam: 200 }));
    expect(sonuc.siparisler[0].satirlar).toHaveLength(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("offset=0&limit=100");
  });
});
