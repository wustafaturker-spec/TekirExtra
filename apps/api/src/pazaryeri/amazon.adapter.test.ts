import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonAdapter } from "./amazon.adapter";

afterEach(() => vi.unstubAllGlobals());
describe("AmazonAdapter", () => {
  it("stok ve fiyatı JSON_LISTINGS_FEED olarak yükler", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "lwa-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ feedDocumentId: "doc-1", url: "https://upload.example/doc-1" }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ feedId: "feed-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new AmazonAdapter().stokFiyatGonder({ kullaniciAdi: "client", parola: "secret", apiAnahtari: "refresh", saticiId: "seller-1", magazaId: "market-1" }, [{ sku: "SKU-1", barkod: "8690", miktar: 6.8, fiyat: 225.456 }]);
    expect(sonuc).toEqual({ gonderilen: 1, islemIdleri: ["feed-1"] });
    const belge = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(belge.header).toEqual(expect.objectContaining({ sellerId: "seller-1", version: "2.0" }));
    expect(belge.messages[0].patches).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/attributes/fulfillment_availability" }), expect.objectContaining({ path: "/attributes/purchasable_offer" })]));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ feedType: "JSON_LISTINGS_FEED", marketplaceIds: ["market-1"], inputFeedDocumentId: "doc-1" });
  });

  it("LWA jetonu alır, siparişleri normalize eder ve sayfalama bağlamını korur", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "lwa-token" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        orders: [{ orderId: "AMZ-1", createdTime: "2026-08-10T09:00:00Z", fulfillmentStatus: "UNSHIPPED", buyer: { name: "Ada Yılmaz", email: "ada@example.com" }, recipient: { deliveryAddress: { name: "Ada Yılmaz", city: "İstanbul" } }, orderTotal: { amount: "600", currencyCode: "TRY" }, orderItems: [{ orderItemId: "i-1", quantityOrdered: 2, product: { sellerSku: "SKU-1", asin: "B001", title: "Ürün" }, itemPrice: { amount: "600" }, tax: { rate: 20 } }] }],
        pagination: { nextToken: "next-1" },
      }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new AmazonAdapter().siparisleriCek({ kullaniciAdi: "client-id", parola: "client-secret", apiAnahtari: "refresh", magazaId: "A33AVAJ2PDY3EV" });
    expect(sonuc.siparisler[0]).toEqual(expect.objectContaining({ hariciId: "AMZ-1", toplam: 600, dovizCinsi: "TRY" }));
    expect(sonuc.siparisler[0].satirlar[0]).toEqual(expect.objectContaining({ sku: "SKU-1", miktar: 2, birimFiyat: 300 }));
    expect(JSON.parse(sonuc.sonrakiImlec!)).toEqual(expect.objectContaining({ token: "next-1" }));
    expect(fetchMock.mock.calls[0][1].body.toString()).toContain("refresh_token=refresh");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/orders/2026-01-01/orders");
    expect(fetchMock.mock.calls[1][1].headers["x-amz-access-token"]).toBe("lwa-token");
  });
});
