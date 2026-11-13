import type { PazaryeriAdaptoru, SiparisSayfasi } from "./adaptor";
import { doviz, EK_UCRET_SKU, enGec, guvenliIstek, imlecOku, imlecYaz, IPTAL_DURUMU, jsonVeyaHata, KARGO_SKU, kdvOraniTuret, kurus, sayi, siteKoku, vknTcknBul } from "./eticaret-ortak";
import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

/**
 * ETC-08: WooCommerce REST API v3. Kimlik: site adresi (`servisAdresi`), consumer key
 * (`kullaniciAdi`) ve consumer secret (`parola`), HTTPS üzerinden Basic.
 * Siparişler değişiklik zamanına göre (`modified_after`, GMT) artan sırayla, sayfa sayfa okunur.
 */
const SAYFA = 50;
/** Ödemesi alınmamış ya da taslak siparişler alınmaz; iptal/iade iptal olarak işlenir. */
const ALINMAYAN = new Set(["pending", "failed", "checkout-draft", "trash"]);
const IPTAL = new Set(["cancelled", "refunded"]);

interface WooMeta { key?: string; value?: unknown }
interface WooSatir { id: number; name: string; sku?: string; quantity: number; total: string; total_tax: string; meta_data?: WooMeta[] }
interface WooUcret { id: number; method_title?: string; name?: string; total: string; total_tax: string }
export interface WooSiparis {
  id: number; number?: string; status: string; currency: string; date_created_gmt?: string; date_modified_gmt?: string; total: string;
  billing?: { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; email?: string; phone?: string };
  shipping?: Record<string, string | undefined>;
  line_items: WooSatir[]; shipping_lines?: WooUcret[]; fee_lines?: WooUcret[]; meta_data?: WooMeta[];
}

const gmt = (t?: string) => (t ? (t.endsWith("Z") ? t : `${t}Z`) : undefined);
const dahil = (net: string, kdv: string) => kurus(sayi(net) + sayi(kdv));

/** Türkiye eklentilerinin (TC kimlik, vergi no) meta alanları. */
function vergiNo(meta: WooMeta[] | undefined): string | undefined {
  const adaylar = (meta ?? []).filter((m) => /tc|tckn|kimlik|vergi.?no|vkn|tax.?(no|number|id)/i.test(m.key ?? "")).map((m) => m.value);
  return vknTcknBul(...adaylar);
}

export function wooSiparisDonustur(s: WooSiparis): NormalizeSiparis | null {
  if (ALINMAYAN.has(s.status)) return null;
  const b = s.billing ?? {};
  const satirlar: NormalizeSiparis["satirlar"] = s.line_items.map((l) => {
    const miktar = sayi(l.quantity) || 1;
    return {
      hariciSatirId: String(l.id), sku: (l.sku || `WC-${l.id}`).trim(), urunAdi: l.name, miktar,
      birimFiyat: kurus(dahil(l.total, l.total_tax) / miktar), kdvOrani: kdvOraniTuret(sayi(l.total), sayi(l.total_tax)),
    };
  });
  for (const k of s.shipping_lines ?? []) {
    const tutar = dahil(k.total, k.total_tax);
    if (tutar > 0) satirlar.push({ hariciSatirId: `kargo-${k.id}`, sku: KARGO_SKU, urunAdi: k.method_title || "Kargo", miktar: 1, birimFiyat: tutar, kdvOrani: kdvOraniTuret(sayi(k.total), sayi(k.total_tax)) });
  }
  for (const f of s.fee_lines ?? []) {
    const tutar = dahil(f.total, f.total_tax);
    if (tutar !== 0) satirlar.push({ hariciSatirId: `ucret-${f.id}`, sku: EK_UCRET_SKU, urunAdi: f.name || "Ek ücret", miktar: 1, birimFiyat: tutar, kdvOrani: kdvOraniTuret(sayi(f.total), sayi(f.total_tax)) });
  }
  const ad = [b.first_name, b.last_name].filter(Boolean).join(" ").trim();
  return {
    hariciId: String(s.id), siparisNo: s.number || String(s.id), hariciDurum: IPTAL.has(s.status) ? IPTAL_DURUMU : s.status,
    siparisTarihi: gmt(s.date_created_gmt) ?? new Date().toISOString(),
    musteriUnvani: (b.company?.trim() || ad || "Web müşterisi").slice(0, 200), musteriEposta: b.email || undefined, musteriTelefon: b.phone || undefined,
    vknTckn: vergiNo(s.meta_data), dovizCinsi: doviz(s.currency), toplam: kurus(sayi(s.total)),
    teslimatAdresi: { fatura: { ad, firma: b.company, adres: [b.address_1, b.address_2].filter(Boolean).join(" "), il: b.state, ilce: b.city, postaKodu: b.postcode, ulke: b.country }, teslimat: s.shipping },
    satirlar,
  };
}

export class WooCommerceAdapter implements PazaryeriAdaptoru {
  private yetki(config: PazaryeriConfig) {
    if (!config.kullaniciAdi || !config.parola) throw new Error("WooCommerce consumer key ve consumer secret zorunludur");
    return { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, Accept: "application/json" };
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi> {
    const kok = siteKoku(config.servisAdresi);
    const durum = imlecOku(imlec);
    const sayfa = durum.sayfa ?? 1;
    const url = new URL(`${kok}/wp-json/wc/v3/orders`);
    url.searchParams.set("per_page", String(SAYFA)); url.searchParams.set("page", String(sayfa));
    url.searchParams.set("orderby", "modified"); url.searchParams.set("order", "asc");
    url.searchParams.set("modified_after", durum.sonra); url.searchParams.set("dates_are_gmt", "true");
    const ham = await jsonVeyaHata<WooSiparis[]>(await guvenliIstek(url.toString(), { headers: this.yetki(config) }), "WooCommerce siparişleri");
    let enSon = durum.enSon;
    for (const s of ham) enSon = enGec(enSon, gmt(s.date_modified_gmt));
    const siparisler = ham.map(wooSiparisDonustur).filter((s): s is NormalizeSiparis => Boolean(s));
    const devamVar = ham.length === SAYFA;
    // Son sayfada bir sonraki çalıştırma en son değişiklikten başlar (aynı saniyedeki kayıt yeniden gelir, içe aktarım tekrar korumalı).
    const sonraki = devamVar ? { ...durum, sayfa: sayfa + 1, enSon } : { sonra: enSon ?? durum.sonra };
    return { siparisler, sonrakiImlec: imlecYaz(sonraki), devamVar };
  }

  /** ETC-06: SKU ile bulunan ürün/varyasyonun stok ve normal fiyatı; bulunamayan atlanır, yeni ürün açılmaz. */
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan: number }> {
    const kok = siteKoku(config.servisAdresi);
    const baslik = { ...this.yetki(config), "Content-Type": "application/json" };
    let gonderilen = 0, bulunamayan = 0;
    for (const k of kalemler) {
      if (!k.sku) { bulunamayan++; continue; }
      const aranan = new URL(`${kok}/wp-json/wc/v3/products`); aranan.searchParams.set("sku", k.sku);
      const urunler = await jsonVeyaHata<Array<{ id: number; parent_id?: number; type: string }>>(await guvenliIstek(aranan.toString(), { headers: baslik }), "WooCommerce ürün araması");
      const u = urunler[0];
      if (!u) { bulunamayan++; continue; }
      const govde = JSON.stringify({ manage_stock: true, stock_quantity: Math.max(0, Math.floor(k.miktar)), ...(k.fiyat > 0 ? { regular_price: k.fiyat.toFixed(2) } : {}) });
      const yol = u.type === "variation" && u.parent_id ? `products/${u.parent_id}/variations/${u.id}` : `products/${u.id}`;
      await jsonVeyaHata(await guvenliIstek(`${kok}/wp-json/wc/v3/${yol}`, { method: "PUT", headers: baslik, body: govde }), "WooCommerce stok/fiyat");
      gonderilen++;
    }
    return { gonderilen, islemIdleri: [], bulunamayan };
  }

  async sina(config: PazaryeriConfig) {
    const url = new URL(`${siteKoku(config.servisAdresi)}/wp-json/wc/v3/orders`); url.searchParams.set("per_page", "1");
    const son = await jsonVeyaHata<WooSiparis[]>(await guvenliIstek(url.toString(), { headers: this.yetki(config) }), "WooCommerce");
    return { mesaj: son[0] ? `Bağlantı çalışıyor; son sipariş #${son[0].number ?? son[0].id}.` : "Bağlantı çalışıyor; henüz sipariş yok." };
  }
}
