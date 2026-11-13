import type { PazaryeriAdaptoru, SiparisSayfasi } from "./adaptor";
import { doviz, enGec, kdvDahilFiyat, guvenliIstek, imlecOku, imlecYaz, IPTAL_DURUMU, jsonVeyaHata, KARGO_SKU, kurus, onbellekliAnahtar, sayi, vknTcknBul } from "./eticaret-ortak";
import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

/**
 * ETC-09: Shopify GraphQL Admin API. Mağaza (`kullaniciAdi`, `ad` ya da `ad.myshopify.com`) ve
 *  (a) eski özel uygulamanın erişim anahtarı (`apiAnahtari`, shpat_…) ya da
 *  (b) Dev Dashboard uygulamasının istemci kimliği/sırrı (`saticiId` / `parola`): anahtar
 *      client_credentials ile alınır, süresi dolunca yenilenir (uygulama ve mağaza aynı kuruluşta olmalı).
 */
export const SHOPIFY_API_SURUMU = "2025-10";
const SAYFA = 50;

export function shopifyMagaza(ad: string | undefined): string {
  const m = (ad ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(m)) throw new Error("Shopify mağaza adı geçersiz (ör. magazam ya da magazam.myshopify.com)");
  return `${m}.myshopify.com`;
}

interface Para { shopMoney: { amount: string } }
interface VergiSatiri { rate: number; priceSet: Para }
export interface ShopifySiparis {
  id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; displayFinancialStatus: string | null;
  currencyCode: string; taxesIncluded: boolean; email: string | null; phone: string | null; note: string | null;
  totalPriceSet: Para;
  billingAddress: { name?: string; company?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; countryCodeV2?: string; phone?: string } | null;
  shippingAddress: Record<string, unknown> | null;
  customAttributes?: Array<{ key: string; value: string | null }>;
  lineItems: { nodes: Array<{ id: string; sku: string | null; name: string; quantity: number; variant: { barcode: string | null } | null; originalTotalSet: Para; discountAllocations: Array<{ allocatedAmountSet: Para }>; taxLines: VergiSatiri[] }> };
  shippingLines: { nodes: Array<{ id: string | null; title: string; discountedPriceSet: Para; taxLines: VergiSatiri[] }> };
}

const SIPARIS_SORGUSU = `query Siparisler($first:Int!,$after:String,$q:String){orders(first:$first,after:$after,sortKey:UPDATED_AT,query:$q){pageInfo{hasNextPage endCursor}nodes{id name createdAt updatedAt cancelledAt displayFinancialStatus currencyCode taxesIncluded email phone note totalPriceSet{shopMoney{amount}}billingAddress{name company address1 address2 city province zip countryCodeV2 phone}shippingAddress{name address1 address2 city province zip countryCodeV2 phone}customAttributes{key value}lineItems(first:100){nodes{id sku name quantity variant{barcode}originalTotalSet{shopMoney{amount}}discountAllocations{allocatedAmountSet{shopMoney{amount}}}taxLines{rate priceSet{shopMoney{amount}}}}}shippingLines(first:10){nodes{id title discountedPriceSet{shopMoney{amount}}taxLines{rate priceSet{shopMoney{amount}}}}}}}}`;

const tutar = (p: Para | null | undefined) => sayi(p?.shopMoney.amount);
const vergi = (t: VergiSatiri[]) => t.reduce((x, v) => x + tutar(v.priceSet), 0);
const oran = (t: VergiSatiri[]) => (t[0] ? Math.round(t[0].rate * 10000) / 100 : null);
/** Ödemesi beklenen ya da süresi dolmuş sipariş alınmaz; iade edilen iptal sayılır. */
const ALINMAYAN = new Set(["PENDING", "EXPIRED"]);

export function shopifySiparisDonustur(s: ShopifySiparis): NormalizeSiparis | null {
  if (!s.cancelledAt && s.displayFinancialStatus && ALINMAYAN.has(s.displayFinancialStatus)) return null;
  const dahilEt = (net: number, t: VergiSatiri[]) => kurus(s.taxesIncluded ? net : net + vergi(t));
  const satirlar: NormalizeSiparis["satirlar"] = s.lineItems.nodes.map((l) => {
    // discountAllocations satır ve sipariş düzeyi indirimlerin satıra düşen payıdır.
    const net = tutar(l.originalTotalSet) - l.discountAllocations.reduce((x, d) => x + tutar(d.allocatedAmountSet), 0);
    const miktar = l.quantity || 1;
    return { hariciSatirId: l.id, sku: (l.sku || l.variant?.barcode || l.id).trim(), barkod: l.variant?.barcode || undefined, urunAdi: l.name, miktar, birimFiyat: kurus(dahilEt(net, l.taxLines) / miktar), kdvOrani: oran(l.taxLines) };
  });
  for (const [i, k] of s.shippingLines.nodes.entries()) {
    const t = dahilEt(tutar(k.discountedPriceSet), k.taxLines);
    if (t > 0) satirlar.push({ hariciSatirId: k.id ?? `kargo-${i}`, sku: KARGO_SKU, urunAdi: k.title || "Kargo", miktar: 1, birimFiyat: t, kdvOrani: oran(k.taxLines) });
  }
  const a = s.billingAddress ?? {};
  const vkn = vknTcknBul(...(s.customAttributes ?? []).filter((c) => /tc|tckn|kimlik|vergi|vkn|tax/i.test(c.key)).map((c) => c.value));
  const iptal = Boolean(s.cancelledAt) || s.displayFinancialStatus === "REFUNDED" || s.displayFinancialStatus === "VOIDED";
  return {
    hariciId: s.id, siparisNo: s.name, hariciDurum: iptal ? IPTAL_DURUMU : (s.displayFinancialStatus ?? "").toLowerCase(), siparisTarihi: s.createdAt,
    musteriUnvani: (a.company || a.name || s.email || "Web müşterisi").slice(0, 200), musteriEposta: s.email ?? undefined, musteriTelefon: s.phone ?? a.phone ?? undefined,
    vknTckn: vkn, dovizCinsi: doviz(s.currencyCode), toplam: kurus(tutar(s.totalPriceSet)),
    teslimatAdresi: { fatura: { ad: a.name, firma: a.company, adres: [a.address1, a.address2].filter(Boolean).join(" "), il: a.province, ilce: a.city, postaKodu: a.zip, ulke: a.countryCodeV2 }, teslimat: s.shippingAddress },
    satirlar,
  };
}

export class ShopifyAdapter implements PazaryeriAdaptoru {
  private async anahtar(config: PazaryeriConfig): Promise<string> {
    if (config.apiAnahtari) return config.apiAnahtari;
    const magaza = shopifyMagaza(config.kullaniciAdi);
    if (!config.saticiId || !config.parola) throw new Error("Shopify için erişim anahtarı ya da istemci kimliği ve sırrı zorunludur");
    return onbellekliAnahtar(`shopify:${magaza}:${config.saticiId}`, async () => {
      const govde = new URLSearchParams({ grant_type: "client_credentials", client_id: config.saticiId!, client_secret: config.parola! });
      const v = await jsonVeyaHata<{ access_token: string; expires_in?: number }>(await guvenliIstek(`https://${magaza}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: govde.toString() }), "Shopify anahtar");
      return { deger: v.access_token, saniye: v.expires_in ?? 86_400 };
    });
  }

  async graphql<T>(config: PazaryeriConfig, sorgu: string, degiskenler: Record<string, unknown> = {}): Promise<T> {
    const magaza = shopifyMagaza(config.kullaniciAdi);
    const yanit = await guvenliIstek(`https://${magaza}/admin/api/${SHOPIFY_API_SURUMU}/graphql.json`, {
      method: "POST", headers: { "X-Shopify-Access-Token": await this.anahtar(config), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: sorgu, variables: degiskenler }),
    });
    const v = await jsonVeyaHata<{ data?: T; errors?: Array<{ message: string }> }>(yanit, "Shopify");
    if (v.errors?.length) throw new Error(`Shopify: ${v.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    return v.data as T;
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi> {
    const durum = imlecOku(imlec);
    const v = await this.graphql<{ orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifySiparis[] } }>(config, SIPARIS_SORGUSU, {
      first: SAYFA, after: durum.cursor ?? null, q: `updated_at:>='${durum.sonra}'`,
    });
    let enSon = durum.enSon;
    for (const s of v.orders.nodes) enSon = enGec(enSon, s.updatedAt);
    const siparisler = v.orders.nodes.map(shopifySiparisDonustur).filter((s): s is NormalizeSiparis => Boolean(s));
    const devamVar = v.orders.pageInfo.hasNextPage;
    return { siparisler, sonrakiImlec: imlecYaz(devamVar ? { ...durum, cursor: v.orders.pageInfo.endCursor, enSon } : { sonra: enSon ?? durum.sonra }), devamVar };
  }

  /** ETC-06: varyantlar SKU/barkodla bulunur; stok ilk konumda ayarlanır, fiyat ürün başına toplu güncellenir. */
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan: number }> {
    type Varyant = { id: string; sku: string | null; barcode: string | null; product: { id: string }; inventoryItem: { id: string } };
    const varyantlar: Varyant[] = [];
    let after: string | null = null;
    for (let i = 0; i < 100; i++) {
      const v: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Varyant[] } } = await this.graphql(config, `query($after:String){productVariants(first:250,after:$after){pageInfo{hasNextPage endCursor}nodes{id sku barcode product{id}inventoryItem{id}}}}`, { after });
      varyantlar.push(...v.productVariants.nodes);
      if (!v.productVariants.pageInfo.hasNextPage) break;
      after = v.productVariants.pageInfo.endCursor;
    }
    const konum = (await this.graphql<{ locations: { nodes: Array<{ id: string }> } }>(config, `{locations(first:1){nodes{id}}}`)).locations.nodes[0]?.id;
    if (!konum) throw new Error("Shopify mağazasında stok konumu bulunamadı");
    const bySku = new Map(varyantlar.filter((x) => x.sku).map((x) => [x.sku!, x]));
    const byBarkod = new Map(varyantlar.filter((x) => x.barcode).map((x) => [x.barcode!, x]));
    const eslesen = kalemler.map((k) => ({ k, v: bySku.get(k.sku) ?? (k.barkod ? byBarkod.get(k.barkod) : undefined) })).filter((x): x is { k: PazaryeriStokFiyat; v: Varyant } => Boolean(x.v));
    for (let i = 0; i < eslesen.length; i += 250) {
      const parca = eslesen.slice(i, i + 250);
      const r = await this.graphql<{ inventorySetQuantities: { userErrors: Array<{ message: string }> } }>(config, `mutation($input:InventorySetQuantitiesInput!){inventorySetQuantities(input:$input){userErrors{message}}}`, {
        input: { name: "available", reason: "correction", ignoreCompareQuantity: true, quantities: parca.map(({ k, v }) => ({ inventoryItemId: v.inventoryItem.id, locationId: konum, quantity: Math.max(0, Math.floor(k.miktar)) })) },
      });
      if (r.inventorySetQuantities.userErrors.length) throw new Error(`Shopify stok: ${r.inventorySetQuantities.userErrors.map((e) => e.message).join("; ").slice(0, 300)}`);
    }
    const urunBasina = new Map<string, Array<{ id: string; price: string }>>();
    for (const { k, v } of eslesen) if (k.fiyat > 0) urunBasina.set(v.product.id, [...(urunBasina.get(v.product.id) ?? []), { id: v.id, price: kdvDahilFiyat(k).toFixed(2) }]);
    for (const [productId, variants] of urunBasina) {
      const r = await this.graphql<{ productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } }>(config, `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){userErrors{message}}}`, { productId, variants });
      if (r.productVariantsBulkUpdate.userErrors.length) throw new Error(`Shopify fiyat: ${r.productVariantsBulkUpdate.userErrors.map((e) => e.message).join("; ").slice(0, 300)}`);
    }
    return { gonderilen: eslesen.length, islemIdleri: [], bulunamayan: kalemler.length - eslesen.length };
  }

  async sina(config: PazaryeriConfig) {
    const v = await this.graphql<{ shop: { name: string }; orders: { nodes: Array<{ name: string }> } }>(config, `{shop{name}orders(first:1,sortKey:CREATED_AT,reverse:true){nodes{name}}}`);
    return { mesaj: `${v.shop.name} mağazasına bağlanıldı; ${v.orders.nodes[0] ? `son sipariş ${v.orders.nodes[0].name}` : "henüz sipariş yok"}.` };
  }
}
