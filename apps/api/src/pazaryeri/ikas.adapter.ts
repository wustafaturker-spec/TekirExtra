import type { PazaryeriAdaptoru, SiparisSayfasi } from "./adaptor";
import { doviz, enGec, kdvDahilFiyat, guvenliIstek, imlecOku, imlecYaz, IPTAL_DURUMU, jsonVeyaHata, KARGO_SKU, kurus, onbellekliAnahtar, sayi, vknTcknBul } from "./eticaret-ortak";
import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

/**
 * ETC-10: ikas Admin GraphQL API. Mağaza adı (`kullaniciAdi`), özel uygulamanın istemci kimliği
 * (`saticiId`) ve sırrı (`parola`); anahtar client_credentials ile alınır (4 saat), süresi dolunca yenilenir.
 * Varsayım (belgede tam ad yok, ilk "Sına" ile doğrulanır): `pagination: {page, limit}`, tarih süzgeci
 * `updatedAt: {gte: <ms>}`; tutarlar KDV dahil (Türkiye mağazası), `taxValue` KDV oranıdır.
 */
export const IKAS_GRAPHQL = "https://api.myikas.com/api/v1/admin/graphql";
const SAYFA = 50;

export function ikasMagaza(ad: string | undefined): string {
  const m = (ad ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.myikas\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(m)) throw new Error("ikas mağaza adı geçersiz (ör. magazam ya da magazam.myikas.com)");
  return m;
}

interface IkasAdres { firstName?: string; lastName?: string; company?: string; phone?: string; addressLine1?: string; addressLine2?: string; postalCode?: string; taxNumber?: string; taxOffice?: string; identityNumber?: string; city?: { name?: string }; district?: { name?: string }; country?: { code?: string; name?: string } }
export interface IkasSiparis {
  id: string; orderNumber?: string; status?: string; orderPaymentStatus?: string; orderedAt?: number; updatedAt?: number; currencyCode?: string; totalFinalPrice?: number;
  customer?: { email?: string; firstName?: string; lastName?: string; fullName?: string; phone?: string } | null;
  billingAddress?: IkasAdres | null; shippingAddress?: IkasAdres | null;
  orderLineItems: Array<{ id: string; quantity: number; finalPrice?: number; finalUnitPrice?: number; price?: number; taxValue?: number | null; status?: string; variant?: { id?: string; sku?: string | null; barcodeList?: string[] | null; name?: string; taxValue?: number | null } }>;
  shippingLines?: Array<{ price?: number; title?: string; taxValue?: number | null }> | null;
}

const SIPARIS_SORGUSU = `query($pagination:PaginationInput,$updatedAt:DateFilterInput){listOrder(pagination:$pagination,updatedAt:$updatedAt,sort:"updatedAt"){count hasNext page data{id orderNumber status orderPaymentStatus orderedAt updatedAt currencyCode totalFinalPrice customer{email firstName lastName fullName phone}billingAddress{firstName lastName company phone addressLine1 addressLine2 postalCode taxNumber taxOffice identityNumber city{name}district{name}country{code name}}shippingAddress{firstName lastName phone addressLine1 addressLine2 city{name}district{name}}orderLineItems{id quantity finalPrice finalUnitPrice price taxValue status variant{id sku barcodeList name taxValue}}shippingLines{price title taxValue}}}}`;

const IPTAL = /CANCEL|REFUND/i;
const ALINMAYAN_ODEME = new Set(["WAITING", "FAILED"]);
const iso = (ms?: number) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

export function ikasSiparisDonustur(s: IkasSiparis): NormalizeSiparis | null {
  const iptal = IPTAL.test(s.status ?? "");
  if (!iptal && s.orderPaymentStatus && ALINMAYAN_ODEME.has(s.orderPaymentStatus)) return null;
  const satirlar: NormalizeSiparis["satirlar"] = s.orderLineItems.filter((l) => !IPTAL.test(l.status ?? "")).map((l) => {
    const miktar = l.quantity || 1;
    const birim = l.finalUnitPrice ?? (l.finalPrice !== undefined ? sayi(l.finalPrice) / miktar : sayi(l.price));
    const v = l.variant ?? {};
    return { hariciSatirId: l.id, sku: (v.sku || v.barcodeList?.[0] || v.id || l.id).trim(), barkod: v.barcodeList?.[0] || undefined, urunAdi: v.name || "Ürün", miktar, birimFiyat: kurus(birim), kdvOrani: l.taxValue ?? v.taxValue ?? null };
  });
  for (const [i, k] of (s.shippingLines ?? []).entries()) {
    if (sayi(k.price) > 0) satirlar.push({ hariciSatirId: `kargo-${i}`, sku: KARGO_SKU, urunAdi: k.title || "Kargo", miktar: 1, birimFiyat: kurus(sayi(k.price)), kdvOrani: k.taxValue ?? null });
  }
  const b = s.billingAddress ?? {};
  const ad = [b.firstName, b.lastName].filter(Boolean).join(" ") || s.customer?.fullName || [s.customer?.firstName, s.customer?.lastName].filter(Boolean).join(" ");
  return {
    hariciId: s.id, siparisNo: s.orderNumber || s.id, hariciDurum: iptal ? IPTAL_DURUMU : (s.status ?? "").toLowerCase(), siparisTarihi: iso(s.orderedAt) ?? new Date().toISOString(),
    musteriUnvani: (b.company || ad || s.customer?.email || "Web müşterisi").slice(0, 200), musteriEposta: s.customer?.email, musteriTelefon: s.customer?.phone ?? b.phone,
    vknTckn: vknTcknBul(b.taxNumber, b.identityNumber), dovizCinsi: doviz(s.currencyCode), toplam: kurus(sayi(s.totalFinalPrice)),
    teslimatAdresi: { fatura: { ad, firma: b.company, adres: [b.addressLine1, b.addressLine2].filter(Boolean).join(" "), il: b.city?.name, ilce: b.district?.name, postaKodu: b.postalCode, ulke: b.country?.code, vergiDairesi: b.taxOffice }, teslimat: s.shippingAddress },
    satirlar,
  };
}

export class IkasAdapter implements PazaryeriAdaptoru {
  private async anahtar(config: PazaryeriConfig): Promise<string> {
    const magaza = ikasMagaza(config.kullaniciAdi);
    if (!config.saticiId || !config.parola) throw new Error("ikas istemci kimliği ve sırrı zorunludur");
    return onbellekliAnahtar(`ikas:${magaza}:${config.saticiId}`, async () => {
      const govde = new URLSearchParams({ grant_type: "client_credentials", client_id: config.saticiId!, client_secret: config.parola! });
      const v = await jsonVeyaHata<{ access_token: string; expires_in?: number }>(await guvenliIstek(`https://${magaza}.myikas.com/api/admin/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: govde.toString() }), "ikas anahtar");
      return { deger: v.access_token, saniye: v.expires_in ?? 14_400 };
    });
  }

  async graphql<T>(config: PazaryeriConfig, sorgu: string, degiskenler: Record<string, unknown> = {}): Promise<T> {
    const yanit = await guvenliIstek(IKAS_GRAPHQL, { method: "POST", headers: { Authorization: `Bearer ${await this.anahtar(config)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: sorgu, variables: degiskenler }) });
    const v = await jsonVeyaHata<{ data?: T; errors?: Array<{ message: string }> }>(yanit, "ikas");
    if (v.errors?.length) throw new Error(`ikas: ${v.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    return v.data as T;
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi> {
    const durum = imlecOku(imlec);
    const sayfa = durum.sayfa ?? 1;
    const v = await this.graphql<{ listOrder: { hasNext: boolean; data: IkasSiparis[] } }>(config, SIPARIS_SORGUSU, { pagination: { page: sayfa, limit: SAYFA }, updatedAt: { gte: Date.parse(durum.sonra) } });
    let enSon = durum.enSon;
    for (const s of v.listOrder.data) enSon = enGec(enSon, iso(s.updatedAt));
    const siparisler = v.listOrder.data.map(ikasSiparisDonustur).filter((s): s is NormalizeSiparis => Boolean(s));
    const devamVar = v.listOrder.hasNext;
    return { siparisler, sonrakiImlec: imlecYaz(devamVar ? { ...durum, sayfa: sayfa + 1, enSon } : { sonra: enSon ?? durum.sonra }), devamVar };
  }

  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan: number }> {
    type Varyant = { productId: string; id: string; sku?: string | null; barcodeList?: string[] | null };
    const varyantlar: Varyant[] = [];
    for (let page = 1; page <= 200; page++) {
      const v = await this.graphql<{ listProduct: { hasNext: boolean; data: Array<{ id: string; variants: Array<{ id: string; sku?: string | null; barcodeList?: string[] | null }> }> } }>(config, `query($pagination:PaginationInput){listProduct(pagination:$pagination){hasNext data{id variants{id sku barcodeList}}}}`, { pagination: { page, limit: 50 } });
      for (const u of v.listProduct.data) for (const x of u.variants) varyantlar.push({ productId: u.id, ...x });
      if (!v.listProduct.hasNext) break;
    }
    const konum = (await this.graphql<{ listStockLocation: Array<{ id: string }> }>(config, `{listStockLocation{id}}`)).listStockLocation[0]?.id;
    if (!konum) throw new Error("ikas mağazasında stok konumu bulunamadı");
    const bySku = new Map(varyantlar.filter((x) => x.sku).map((x) => [x.sku!, x]));
    const byBarkod = new Map(varyantlar.flatMap((x) => (x.barcodeList ?? []).map((b) => [b, x] as const)));
    const eslesen = kalemler.map((k) => ({ k, v: bySku.get(k.sku) ?? (k.barkod ? byBarkod.get(k.barkod) : undefined) })).filter((x): x is { k: PazaryeriStokFiyat; v: Varyant } => Boolean(x.v));
    for (let i = 0; i < eslesen.length; i += 200) {
      const parca = eslesen.slice(i, i + 200);
      await this.graphql(config, `mutation($input:SaveStockLocationsInput!){saveProductStockLocations(input:$input)}`, { input: { productStockLocationInputs: parca.map(({ k, v }) => ({ productId: v.productId, variantId: v.id, stockCount: Math.max(0, Math.floor(k.miktar)), stockLocationId: konum })) } });
      const fiyatli = parca.filter(({ k }) => k.fiyat > 0);
      if (fiyatli.length) await this.graphql(config, `mutation($input:SaveVariantPricesInput!){saveVariantPrices(input:$input)}`, { input: { variantPriceInputs: fiyatli.map(({ k, v }) => ({ productId: v.productId, variantId: v.id, price: { sellPrice: kdvDahilFiyat(k) } })) } });
    }
    return { gonderilen: eslesen.length, islemIdleri: [], bulunamayan: kalemler.length - eslesen.length };
  }

  async sina(config: PazaryeriConfig) {
    const v = await this.graphql<{ listOrder: { count?: number; data: IkasSiparis[] } }>(config, `query{listOrder(pagination:{page:1,limit:1},sort:"-orderedAt"){count data{orderNumber}}}`);
    const son = v.listOrder.data[0]?.orderNumber;
    return { mesaj: son ? `ikas bağlantısı çalışıyor; son sipariş ${son}.` : "ikas bağlantısı çalışıyor; henüz sipariş yok." };
  }
}
