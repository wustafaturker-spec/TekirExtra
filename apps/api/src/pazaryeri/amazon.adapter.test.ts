import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonAdapter } from "./amazon.adapter";

afterEach(() => vi.unstubAllGlobals());
describe("AmazonAdapter", () => {
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
