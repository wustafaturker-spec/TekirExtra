import type { NormalizeKesinti, NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";
import { dovizKoduMu } from "@tekirextra/shared";

interface AmazonImlec { token?: string; lastUpdatedAfter: string }
interface AmazonFinansImleci { token?: string; postedAfter: string; postedBefore?: string }

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

function finansImleciniCoz(imlec?: string | null): AmazonFinansImleci {
  if (imlec) {
    try { const sonuc = JSON.parse(imlec) as AmazonFinansImleci; if (sonuc.postedAfter) return sonuc; } catch { /* Yeni pencere açılır. */ }
  }
  return { postedAfter: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString() };
}

export class AmazonAdapter {
  private async erisimTokeniAl(config: PazaryeriConfig): Promise<string> {
    if (!config.parola || !config.apiAnahtari) throw new Error("Amazon LWA client secret ve refresh token zorunludur");
    const tokenYaniti = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.apiAnahtari, client_id: config.kullaniciAdi, client_secret: config.parola }),
    });
    if (!tokenYaniti.ok) throw new Error(`Amazon LWA jeton servisi HTTP ${tokenYaniti.status}`);
    const tokenVerisi = await tokenYaniti.json() as { access_token?: string };
    if (!tokenVerisi.access_token) throw new Error("Amazon LWA erişim jetonu dönmedi");
    return tokenVerisi.access_token;
  }

  private spApiBasliklari(token: string): Record<string, string> {
    return { "x-amz-access-token": token, "x-amz-date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""), "User-Agent": "TekirExtra/1.0 (Language=TypeScript)", "Content-Type": "application/json", Accept: "application/json" };
  }

  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[] }> {
    if (!config.saticiId || !config.magazaId) throw new Error("Amazon Seller ID ve marketplace ID zorunludur");
    if (!kalemler.length) return { gonderilen: 0, islemIdleri: [] };
    const token = await this.erisimTokeniAl(config);
    const belge = JSON.stringify({
      header: { sellerId: config.saticiId, version: "2.0", issueLocale: "tr_TR" },
      messages: kalemler.map((k, i) => ({ messageId: i + 1, sku: k.sku, operationType: "PATCH", productType: "PRODUCT", patches: [
        { op: "replace", path: "/attributes/fulfillment_availability", value: [{ fulfillment_channel_code: "DEFAULT", quantity: Math.max(0, Math.floor(k.miktar)) }] },
        { op: "replace", path: "/attributes/purchasable_offer", value: [{ audience: "ALL", currency: "TRY", our_price: [{ schedule: [{ value_with_tax: Number(k.fiyat.toFixed(2)) }] }] }] },
      ] })),
    });
    if (Buffer.byteLength(belge) > 10 * 1024 * 1024) throw new Error("Amazon stok/fiyat feed belgesi 10 MiB sınırını aşıyor");
    const belgeYaniti = await fetch("https://sellingpartnerapi-eu.amazon.com/feeds/2021-06-30/documents", { method: "POST", headers: this.spApiBasliklari(token), body: JSON.stringify({ contentType: "application/json; charset=UTF-8" }) });
    if (!belgeYaniti.ok) throw new Error(`Amazon feed belgesi servisi HTTP ${belgeYaniti.status}`);
    const belgeVerisi = await belgeYaniti.json() as { feedDocumentId?: string; url?: string };
    if (!belgeVerisi.feedDocumentId || !belgeVerisi.url) throw new Error("Amazon feed belgesi kimliği veya yükleme adresi dönmedi");
    const yuklemeYaniti = await fetch(belgeVerisi.url, { method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: belge });
    if (!yuklemeYaniti.ok) throw new Error(`Amazon feed yükleme servisi HTTP ${yuklemeYaniti.status}`);
    const feedYaniti = await fetch("https://sellingpartnerapi-eu.amazon.com/feeds/2021-06-30/feeds", { method: "POST", headers: this.spApiBasliklari(token), body: JSON.stringify({ feedType: "JSON_LISTINGS_FEED", marketplaceIds: [config.magazaId], inputFeedDocumentId: belgeVerisi.feedDocumentId }) });
    if (!feedYaniti.ok) throw new Error(`Amazon feed oluşturma servisi HTTP ${feedYaniti.status}`);
    const feedVerisi = await feedYaniti.json() as { feedId?: string };
    if (!feedVerisi.feedId) throw new Error("Amazon stok/fiyat işlemi feedId dönmedi");
    return { gonderilen: kalemler.length, islemIdleri: [String(feedVerisi.feedId)] };
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ siparisler: NormalizeSiparis[]; sonrakiImlec: string | null }> {
    if (!config.parola || !config.apiAnahtari || !config.magazaId) {
      throw new Error("Amazon LWA client secret, refresh token ve marketplace ID zorunludur");
    }

    const erisimTokeni = await this.erisimTokeniAl(config);

    const sayfaImleci = imleciCoz(imlec);
    const url = new URL("https://sellingpartnerapi-eu.amazon.com/orders/2026-01-01/orders");
    url.searchParams.set("marketplaceIds", config.magazaId);
    url.searchParams.set("lastUpdatedAfter", sayfaImleci.lastUpdatedAfter);
    url.searchParams.set("maxResultsPerPage", "100");
    url.searchParams.set("includedData", "BUYER,RECIPIENT,PROCEEDS,TAX");
    if (sayfaImleci.token) url.searchParams.set("paginationToken", sayfaImleci.token);
    const yanit = await fetch(url, {
      headers: {
        "x-amz-access-token": erisimTokeni,
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
        // PZR-05: ItemPrice satır toplamıdır (birim × miktar, SP-API modeli); promosyon ayrı alandır ve düşülür.
        // proceeds.itemCharge yolunda promosyonun durumu belgelenemedi, dokunulmaz (tutar kilidi korur).
        const fiyat = para(s.itemPrice ?? s.ItemPrice);
        const toplam = fiyat ? fiyat - para(s.promotionDiscount ?? s.PromotionDiscount) : para(s.proceeds?.itemCharge ?? s.Proceeds?.ItemCharge);
        return {
          hariciSatirId: String(s.orderItemId ?? s.OrderItemId), sku: String(s.product?.sellerSku ?? s.SellerSKU ?? ""),
          barkod: s.product?.asin ?? s.ASIN ?? undefined, urunAdi: String(s.product?.title ?? s.Title ?? "Amazon ürünü"),
          miktar, birimFiyat: miktar ? toplam / miktar : toplam, kdvOrani: (s.tax?.rate ?? s.TaxRate) != null ? Number(s.tax?.rate ?? s.TaxRate) : null,
        };
      });
      const toplam = para(p.orderTotal ?? p.OrderTotal) || satirlar.reduce((sum: number, s: NormalizeSiparis["satirlar"][number]) => sum + s.miktar * s.birimFiyat, 0);
      const adres = p.recipient?.deliveryAddress ?? p.ShippingAddress;
      return {
        hariciId: String(p.orderId ?? p.AmazonOrderId), siparisNo: String(p.orderId ?? p.AmazonOrderId),
        hariciDurum: p.fulfillmentStatus ?? p.OrderStatus, siparisTarihi: String(p.createdTime ?? p.PurchaseDate),
        musteriUnvani: p.buyer?.name ?? p.BuyerInfo?.BuyerName ?? adres?.name ?? adres?.Name ?? "Amazon müşterisi",
        musteriEposta: p.buyer?.email ?? p.BuyerInfo?.BuyerEmail ?? undefined, musteriTelefon: adres?.phone ?? adres?.Phone ?? undefined,
        dovizCinsi: (dovizKoduMu(p.orderTotal?.currencyCode ?? p.OrderTotal?.CurrencyCode) ? p.orderTotal?.currencyCode ?? p.OrderTotal?.CurrencyCode : "TRY") as NormalizeSiparis["dovizCinsi"],
        toplam, teslimatAdresi: adres, satirlar,
      };
    }).filter((s: NormalizeSiparis) => s.hariciId !== "undefined" && s.satirlar.length > 0);
    const sonrakiToken = veri.pagination?.nextToken ?? veri.payload?.NextToken;
    return { siparisler, sonrakiImlec: sonrakiToken ? JSON.stringify({ token: String(sonrakiToken), lastUpdatedAfter: sayfaImleci.lastUpdatedAfter }) : null };
  }

  async komisyonKayitlariCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ kesintiler: NormalizeKesinti[]; sonrakiImlec: string }> {
    if (!config.parola || !config.apiAnahtari || !config.magazaId) throw new Error("Amazon finans hareketleri için LWA bilgileri ve marketplace ID zorunludur");
    const erisimTokeni = await this.erisimTokeniAl(config);
    const sayfa = finansImleciniCoz(imlec);
    const postedBefore = sayfa.postedBefore ?? new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const url = new URL("https://sellingpartnerapi-eu.amazon.com/finances/2024-06-19/transactions");
    url.searchParams.set("postedAfter", sayfa.postedAfter); url.searchParams.set("postedBefore", postedBefore);
    url.searchParams.set("marketplaceId", config.magazaId); url.searchParams.set("transactionStatus", "RELEASED"); url.searchParams.set("pageSize", "500");
    if (sayfa.token) url.searchParams.set("nextToken", sayfa.token);
    const yanit = await fetch(url, { headers: this.spApiBasliklari(erisimTokeni) });
    if (!yanit.ok) throw new Error(`Amazon Finances servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any;
    const payload = veri.payload ?? veri;
    const islemler = Array.isArray(payload.transactions) ? payload.transactions : [];
    const kesintiler: NormalizeKesinti[] = [];
    for (const islem of islemler) {
      const siparisNo = (Array.isArray(islem.relatedIdentifiers) ? islem.relatedIdentifiers : []).find((x: any) => x.relatedIdentifierName === "ORDER_ID")?.relatedIdentifierValue;
      const yapraklariGez = (kirimlar: any[], yol: string[] = []) => {
        for (let i = 0; i < kirimlar.length; i += 1) {
          const kirim = kirimlar[i]; const alt = Array.isArray(kirim.breakdowns) ? kirim.breakdowns : [];
          if (alt.length) { yapraklariGez(alt, [...yol, String(kirim.breakdownType ?? i)]); continue; }
          const miktar = Number(kirim.breakdownAmount?.currencyAmount ?? 0);
          const doviz = String(kirim.breakdownAmount?.currencyCode ?? islem.totalAmount?.currencyCode ?? "TRY");
          if (miktar >= 0 || !dovizKoduMu(doviz)) continue;
          const tur = String(kirim.breakdownType ?? "Amazon kesintisi");
          kesintiler.push({ hariciId: `${islem.transactionId}:${[...yol, tur, i].join("/")}`, siparisNo: siparisNo ? String(siparisNo) : undefined,
            tur, aciklama: islem.description ? String(islem.description) : undefined, tarih: String(islem.postedDate).slice(0, 10), tutar: Math.abs(miktar),
            dovizCinsi: doviz as NormalizeKesinti["dovizCinsi"], hamVeri: { transactionId: islem.transactionId, transactionType: islem.transactionType, transactionStatus: islem.transactionStatus, breakdown: kirim } });
        }
      };
      yapraklariGez(Array.isArray(islem.breakdowns) ? islem.breakdowns : []);
    }
    const nextToken = payload.nextToken;
    return { kesintiler, sonrakiImlec: JSON.stringify(nextToken ? { token: String(nextToken), postedAfter: sayfa.postedAfter, postedBefore } : { postedAfter: postedBefore }) };
  }
}
