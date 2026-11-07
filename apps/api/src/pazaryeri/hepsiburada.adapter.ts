import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";
import { disFetch } from "../core/guvenlik/dis-istek";
import { dovizKoduMu } from "@tekirextra/shared";
import { HbYanitHatasi, hbKaydiOku, type HbKayit } from "./hepsiburada-finans";

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GUN_MS = 86_400_000;
const gunEkle = (gun: string, n: number) => new Date(Date.parse(`${gun}T00:00:00Z`) + n * GUN_MS).toISOString().slice(0, 10);

const para = (deger: any): number => Number(deger?.amount ?? deger ?? 0);
const metin = (deger: unknown): string => deger === null || deger === undefined ? "" : String(deger);
/** PZR-21: Hepsiburada User-Agent ile entegratörü tanır (yeni kimlik doğrulama); tanımlı değilse eski değer. */
export const hbKullaniciAjani = (config: PazaryeriConfig): string => config.entegratorAdi?.trim() || "TekirExtra/1.0";
const xml = (deger: string): string => deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export class HepsiburadaAdapter {
  /** PZR-21: sayfalar arası bekleme (ms); testte 0. */
  constructor(private readonly sayfaArasiMs = 250) {}

  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[] }> {
    if (!config.magazaId || !config.parola) throw new Error("Hepsiburada Merchant ID ve parola zorunludur");
    const islemIdleri: string[] = [];
    for (let baslangic = 0; baslangic < kalemler.length; baslangic += 4000) {
      const parca = kalemler.slice(baslangic, baslangic + 4000);
      const govde = `<?xml version="1.0" encoding="UTF-8"?><listings>${parca.map((k) => `<listing><MerchantSku>${xml(k.sku)}</MerchantSku><Price>${k.fiyat.toFixed(2)}</Price><AvailableStock>${Math.max(0, Math.floor(k.miktar))}</AvailableStock><MaximumPurchasableQuantity>${Math.max(1, Math.floor(k.miktar))}</MaximumPurchasableQuantity></listing>`).join("")}</listings>`;
      const taban = (config.servisAdresi || "https://listing-external.hepsiburada.com").replace(/\/$/, "");
      const yanit = await disFetch(`${taban}/listings/merchantid/${encodeURIComponent(config.magazaId)}/inventory-uploads`, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": hbKullaniciAjani(config), "Content-Type": "application/xml", Accept: "application/json" }, body: govde,
      });
      if (!yanit.ok) throw new Error(`Hepsiburada stok/fiyat servisi HTTP ${yanit.status}`);
      const veri = await yanit.json() as { id?: string; inventoryUploadId?: string; uploadId?: string };
      const islemId = veri.inventoryUploadId ?? veri.uploadId ?? veri.id;
      if (!islemId) throw new Error("Hepsiburada stok/fiyat işlemi işlem kimliği dönmedi");
      islemIdleri.push(String(islemId));
    }
    return { gonderilen: kalemler.length, islemIdleri };
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ siparisler: NormalizeSiparis[]; sonrakiImlec: string | null }> {
    if (!config.magazaId || !config.parola) throw new Error("Hepsiburada Merchant ID ve parola zorunludur");
    const offset = Math.max(0, Number(imlec ?? 0) || 0); const limit = 100;
    const taban = (config.servisAdresi || "https://oms-external.hepsiburada.com").replace(/\/$/, "");
    const url = new URL(`${taban}/orders/merchantid/${encodeURIComponent(config.magazaId)}`);
    url.searchParams.set("offset", String(offset)); url.searchParams.set("limit", String(limit));
    const yanit = await disFetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": hbKullaniciAjani(config), Accept: "application/json" } });
    if (!yanit.ok) throw new Error(`Hepsiburada sipariş servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any; const kayitlar: any[] = Array.isArray(veri) ? veri : Array.isArray(veri.items) ? veri.items : Array.isArray(veri.data) ? veri.data : [];
    const gruplar = new Map<string, any[]>();
    for (const kayit of kayitlar) { const no = metin(kayit.orderNumber ?? kayit.OrderNumber ?? kayit.orderId ?? kayit.id); if (no) gruplar.set(no, [...(gruplar.get(no) ?? []), kayit]); }
    const siparisler: NormalizeSiparis[] = [...gruplar].map(([no, satirKayitlari]) => {
      const ana = satirKayitlari[0]; const hamSatirlar = satirKayitlari.flatMap((k) => Array.isArray(k.lineItems) ? k.lineItems : Array.isArray(k.items) ? k.items : [k]);
      const satirlar = hamSatirlar.map((s: any, i: number) => ({ hariciSatirId: metin(s.lineItemId ?? s.id ?? `${no}-${i}`), sku: metin(s.merchantSku ?? s.merchantSKU ?? s.sku ?? s.hbSku), barkod: metin(s.barcode) || undefined, urunAdi: metin(s.productName ?? s.name ?? s.title) || "Hepsiburada ürünü", miktar: para(s.quantity ?? 1), birimFiyat: para(s.unitPrice ?? s.price), kdvOrani: (s.vatRate ?? s.vat) != null ? para(s.vatRate ?? s.vat) : null }));
      const toplam = para(ana.totalPrice ?? ana.totalAmount) || satirlar.reduce((t, s) => t + s.miktar * s.birimFiyat, 0);
      const adres = ana.shippingAddress ?? ana.deliveryAddress; const tarih = ana.orderDate ?? ana.createdDate ?? ana.purchaseDate;
      return { hariciId: metin(ana.id ?? ana.orderId ?? no), siparisNo: no, hariciDurum: metin(ana.status) || undefined, siparisTarihi: new Date(tarih).toISOString(), musteriUnvani: metin(ana.customerName ?? ana.recipientName ?? adres?.name) || "Hepsiburada müşterisi", musteriEposta: metin(ana.customerEmail ?? ana.email) || undefined, musteriTelefon: metin(ana.customerPhone ?? adres?.phone) || undefined, vknTckn: metin(ana.taxNumber ?? ana.identityNumber) || undefined, dovizCinsi: dovizKoduMu(ana.currency) ? ana.currency : "TRY", toplam, teslimatAdresi: adres, satirlar };
    }).filter((s) => s.satirlar.length > 0 && s.satirlar.every((x) => x.sku));
    return { siparisler, sonrakiImlec: kayitlar.length >= limit ? String(offset + limit) : null };
  }

  /**
   * PZR-21: Kayıt Bazlı Muhasebe Servisi. Tarih alanı `record` (kayıt) ya da
   * `payment` (ödeme) aralığıyla, offset/limit 100 sayfalı. Birden çok döviz
   * 409 dönerse aralık ikiye bölünür; tek günde sürerse hata.
   */
  async finansKayitlariCek(config: PazaryeriConfig, tarihAlani: "record" | "payment", baslangic: string, bitis: string): Promise<{ kayitlar: HbKayit[]; istekSayisi: number }> {
    if (!config.magazaId || !config.parola) throw new Error("Hepsiburada Merchant ID ve parola zorunludur");
    // Belge: canlı adres test adresinden "-sit" kaldırılarak elde edilir.
    const taban = config.servisAdresi?.includes("-sit") ? "https://mpfinance-external-sit.hepsiburada.com" : "https://mpfinance-external.hepsiburada.com";
    let istekSayisi = 0;
    const getir = async (bas: string, son: string): Promise<HbKayit[]> => {
      const kayitlar: HbKayit[] = [];
      for (let offset = 0; offset < 200_000; offset += 100) {
        const url = new URL(`${taban}/transactions/merchantid/${encodeURIComponent(config.magazaId!)}`);
        url.searchParams.set("offset", String(offset)); url.searchParams.set("limit", "100");
        url.searchParams.set(`${tarihAlani}DateStart`, bas); url.searchParams.set(`${tarihAlani}DateEnd`, son);
        let yanit: Response | null = null;
        for (let deneme = 0; deneme < 4; deneme++) {
          istekSayisi++;
          yanit = await disFetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": hbKullaniciAjani(config), Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
          if (yanit.status !== 429 && yanit.status < 500) break;
          const sonra = Number(yanit.headers.get("retry-after"));
          await bekle((this.sayfaArasiMs / 250) * (Number.isFinite(sonra) && sonra > 0 ? Math.min(sonra, 30) * 1000 : 2000 * 2 ** deneme));
        }
        if (yanit!.status === 409) {
          if (bas >= son) throw new Error(`Hepsiburada finans servisi: ${bas} günü birden çok dövizde kayıt döndürdü (HTTP 409)`);
          const orta = gunEkle(bas, Math.floor((Date.parse(son) - Date.parse(bas)) / GUN_MS / 2));
          return [...await getir(bas, orta), ...await getir(gunEkle(orta, 1), son)];
        }
        if (!yanit!.ok) throw new Error(`Hepsiburada finans servisi HTTP ${yanit!.status}`);
        const veri = await yanit!.json() as unknown;
        const o = veri as Record<string, unknown>;
        const liste = Array.isArray(veri) ? veri : [o?.items, o?.data, o?.content, o?.transactions].find(Array.isArray) as unknown[] | undefined;
        if (!liste) throw new HbYanitHatasi(`Hepsiburada finans yanıtında kayıt listesi tanınamadı. Örnek: ${JSON.stringify(veri).slice(0, 800)}`);
        kayitlar.push(...liste.map((k) => hbKaydiOku(k as Record<string, unknown>)));
        await bekle(this.sayfaArasiMs);
        if (liste.length < 100) break;
      }
      return kayitlar;
    };
    return { kayitlar: await getir(baslangic, bitis), istekSayisi };
  }
}
