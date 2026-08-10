import { afterEach, describe, expect, it, vi } from "vitest";
import { N11Adapter } from "./n11.adapter";

afterEach(() => vi.unstubAllGlobals());
describe("N11Adapter", () => {
  it("stok ve fiyatları REST görev servisine gönderir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1092, status: "IN_QUEUE" }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new N11Adapter().stokFiyatGonder({ kullaniciAdi: "app-key", parola: "secret" }, [{ sku: "SKU-1", barkod: "8690", miktar: 4.9, fiyat: 125.456 }]);
    expect(sonuc).toEqual({ gonderilen: 1, islemIdleri: ["1092"] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ payload: { integrator: "TekirExtra", skus: [{ stockCode: "SKU-1", listPrice: 125.46, salePrice: 125.46, quantity: 4, currencyType: "TL" }] } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual(expect.objectContaining({ appkey: "app-key", appsecret: "secret" }));
  });

  it("sellerInvoiceAmount ile fatura birim fiyatini hesaplar ve sayfalar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ totalPages: 2, content: [{ id: "pkg-1", orderNumber: "N11-42", customerfullName: "Ada Yılmaz", customerEmail: "ada@example.com", shipmentPackageStatus: "Created", lastModifiedDate: 1786363200000, packageHistories: [{ status: "Created", createdDate: 1786360000000 }], lines: [{ orderLineId: 7, stockCode: "SKU-1", barcode: "8690", productName: "Ürün", quantity: 2, price: 300, sellerInvoiceAmount: 580, vatRate: 10 }] }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new N11Adapter().siparisleriCek({ kullaniciAdi: "app-key", parola: "secret" });
    expect(sonuc.sonrakiImlec).toBe("1"); expect(sonuc.siparisler[0].toplam).toBe(580);
    expect(sonuc.siparisler[0].satirlar[0]).toEqual(expect.objectContaining({ sku: "SKU-1", birimFiyat: 290 }));
    const istek = fetchMock.mock.calls[0]; expect(String(istek[0])).toContain("page=0&size=100"); expect(istek[1].headers).toEqual(expect.objectContaining({ appkey: "app-key", appsecret: "secret" }));
  });
});
