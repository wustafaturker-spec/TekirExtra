import type { NormalizeSiparis, PazaryeriConfig } from "./trendyol.adapter";

interface AmazonImlec { token?: string; lastUpdatedAfter: string }

function para(deger: unknown): number {
  if (!deger || typeof deger !== "object") return 0;
  const nesne = deger as Record<string, unknown>;
  return Number(nesne.amount ?? nesne.Amount ?? 0);
}

function imleciCoz(imlec?: string | null): AmazonImlec {
  if (imlec) {
    try {
      const sonuc = JSON.parse(imlec) as AmazonImlec;
      if (sonuc.lastUpdatedAfter) return sonuc;
    } catch { /* Eski/geçersiz imleçte yeni pencere açılır. */ }
  }
  return { lastUpdatedAfter: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() };
}

export class AmazonAdapter {
  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ siparisler: NormalizeSiparis[]; sonrakiImlec: string | null }> {
    if (!config.parola || !config.apiAnahtari || !config.magazaId) {
      throw new Error("Amazon LWA client secret, refresh token ve marketplace ID zorunludur");
    }

    const tokenYaniti = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: config.apiAnahtari,
        client_id: config.kullaniciAdi, client_secret: config.parola,
      }),
    });
    if (!tokenYaniti.ok) throw new Error(`Amazon LWA jeton servisi HTTP ${tokenYaniti.status}`);
    const tokenVerisi = await tokenYaniti.json() as { access_token?: string };
    if (!tokenVerisi.access_token) throw new Error("Amazon LWA erişim jetonu dönmedi");

    const sayfaImleci = imleciCoz(imlec);
    const url = new URL("https://sellingpartnerapi-eu.amazon.com/orders/2026-01-01/orders");
    url.searchParams.set("marketplaceIds", config.magazaId);
    url.searchParams.set("lastUpdatedAfter", sayfaImleci.lastUpdatedAfter);
    url.searchParams.set("maxResultsPerPage", "100");
    url.searchParams.set("includedData", "BUYER,RECIPIENT,PROCEEDS,TAX");
    if (sayfaImleci.token) url.searchParams.set("paginationToken", sayfaImleci.token);
    const yanit = await fetch(url, {
      headers: {
        "x-amz-access-token": tokenVerisi.access_token,
        "x-amz-date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
        "User-Agent": "TekirExtra/1.0 (Language=TypeScript)", Accept: "application/json",
      },
    });
    if (!yanit.ok) throw new Error(`Amazon Orders servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any;
    const hamSiparisler = Array.isArray(veri.orders) ? veri.orders : Array.isArray(veri.payload?.Orders) ? veri.payload.Orders : [];
    const siparisler = hamSiparisler.map((p: any): NormalizeSiparis => {
      const satirlar = (Array.isArray(p.orderItems) ? p.orderItems : Array.isArray(p.OrderItems) ? p.OrderItems : []).map((s: any) => {
        const miktar = Number(s.quantityOrdered ?? s.QuantityOrdered ?? 1);
        const toplam = para(s.itemPrice ?? s.ItemPrice) || para(s.proceeds?.itemCharge ?? s.Proceeds?.ItemCharge);
        return {
          hariciSatirId: String(s.orderItemId ?? s.OrderItemId), sku: String(s.product?.sellerSku ?? s.SellerSKU ?? ""),
          barkod: s.product?.asin ?? s.ASIN ?? undefined, urunAdi: String(s.product?.title ?? s.Title ?? "Amazon ürünü"),
          miktar, birimFiyat: miktar ? toplam / miktar : toplam, kdvOrani: Number(s.tax?.rate ?? s.TaxRate ?? 20),
        };
      });
      const toplam = para(p.orderTotal ?? p.OrderTotal) || satirlar.reduce((sum: number, s: NormalizeSiparis["satirlar"][number]) => sum + s.miktar * s.birimFiyat, 0);
      const adres = p.recipient?.deliveryAddress ?? p.ShippingAddress;
      return {
        hariciId: String(p.orderId ?? p.AmazonOrderId), siparisNo: String(p.orderId ?? p.AmazonOrderId),
        hariciDurum: p.fulfillmentStatus ?? p.OrderStatus, siparisTarihi: String(p.createdTime ?? p.PurchaseDate),
        musteriUnvani: p.buyer?.name ?? p.BuyerInfo?.BuyerName ?? adres?.name ?? adres?.Name ?? "Amazon müşterisi",
        musteriEposta: p.buyer?.email ?? p.BuyerInfo?.BuyerEmail ?? undefined, musteriTelefon: adres?.phone ?? adres?.Phone ?? undefined,
        dovizCinsi: (["TRY", "USD", "EUR"].includes(p.orderTotal?.currencyCode ?? p.OrderTotal?.CurrencyCode) ? p.orderTotal?.currencyCode ?? p.OrderTotal?.CurrencyCode : "TRY") as NormalizeSiparis["dovizCinsi"],
        toplam, teslimatAdresi: adres, satirlar,
      };
    }).filter((s: NormalizeSiparis) => s.hariciId !== "undefined" && s.satirlar.length > 0);
    const sonrakiToken = veri.pagination?.nextToken ?? veri.payload?.NextToken;
    return { siparisler, sonrakiImlec: sonrakiToken ? JSON.stringify({ token: String(sonrakiToken), lastUpdatedAfter: sayfaImleci.lastUpdatedAfter }) : null };
  }
}
