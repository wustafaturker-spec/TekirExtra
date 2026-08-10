import { afterEach, describe, expect, it, vi } from "vitest";
import { TrendyolAdapter } from "./trendyol.adapter";

afterEach(() => vi.unstubAllGlobals());

describe("TrendyolAdapter", () => {
  it("stok ve fiyat kalemlerini Trendyol toplu servisine gönderir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ batchRequestId: "batch-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new TrendyolAdapter().stokFiyatGonder({ kullaniciAdi: "api-key", parola: "secret", saticiId: "123" }, [{ sku: "SKU-1", barkod: "8690001", miktar: 8.9, fiyat: 125.5 }]);
    expect(sonuc).toEqual({ gonderilen: 1, islemIdleri: ["batch-1"] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ items: [{ barcode: "8690001", quantity: 8, salePrice: 125.5, listPrice: 125.5 }] });
  });

  it("stream cevabini ortak siparis bicimine ve cursor'a cevirir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasMore: true, nextCursor: "cursor-2", content: [{
      shipmentPackageId: 42, orderNumber: "SP-42", orderDate: 1786363200000, customerFirstName: "Ada", customerLastName: "Yılmaz",
      currencyCode: "TRY", packageTotalPrice: 240, status: "Created", lines: [{ lineId: 7, stockCode: "TS-RED-M", barcode: "8690001", productName: "Tişört", quantity: 2, lineUnitPrice: 120, vatRate: 20 }],
    }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new TrendyolAdapter().siparisleriCek({ kullaniciAdi: "api-key", parola: "secret", saticiId: "123" });
    expect(sonuc.sonrakiImlec).toBe("cursor-2");
    expect(sonuc.siparisler[0]).toEqual(expect.objectContaining({ hariciId: "42", siparisNo: "SP-42", toplam: 240 }));
    expect(sonuc.siparisler[0].satirlar[0]).toEqual(expect.objectContaining({ sku: "TS-RED-M", miktar: 2 }));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/orders/stream?size=50");
  });
});
