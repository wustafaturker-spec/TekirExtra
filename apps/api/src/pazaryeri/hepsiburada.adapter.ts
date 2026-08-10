import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

const para = (deger: any): number => Number(deger?.amount ?? deger ?? 0);
const metin = (deger: unknown): string => deger === null || deger === undefined ? "" : String(deger);
const xml = (deger: string): string => deger.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export class HepsiburadaAdapter {
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[] }> {
    if (!config.magazaId || !config.parola) throw new Error("Hepsiburada Merchant ID ve parola zorunludur");
    const islemIdleri: string[] = [];
    for (let baslangic = 0; baslangic < kalemler.length; baslangic += 4000) {
      const parca = kalemler.slice(baslangic, baslangic + 4000);
      const govde = `<?xml version="1.0" encoding="UTF-8"?><listings>${parca.map((k) => `<listing><MerchantSku>${xml(k.sku)}</MerchantSku><Price>${k.fiyat.toFixed(2)}</Price><AvailableStock>${Math.max(0, Math.floor(k.miktar))}</AvailableStock><MaximumPurchasableQuantity>${Math.max(1, Math.floor(k.miktar))}</MaximumPurchasableQuantity></listing>`).join("")}</listings>`;
      const taban = (config.servisAdresi || "https://listing-external.hepsiburada.com").replace(/\/$/, "");
      const yanit = await fetch(`${taban}/listings/merchantid/${encodeURIComponent(config.magazaId)}/inventory-uploads`, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": "TekirExtra/1.0", "Content-Type": "application/xml", Accept: "application/json" }, body: govde,
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
    const yanit = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": "TekirExtra/1.0", Accept: "application/json" } });
    if (!yanit.ok) throw new Error(`Hepsiburada sipariş servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any; const kayitlar: any[] = Array.isArray(veri) ? veri : Array.isArray(veri.items) ? veri.items : Array.isArray(veri.data) ? veri.data : [];
    const gruplar = new Map<string, any[]>();
    for (const kayit of kayitlar) { const no = metin(kayit.orderNumber ?? kayit.OrderNumber ?? kayit.orderId ?? kayit.id); if (no) gruplar.set(no, [...(gruplar.get(no) ?? []), kayit]); }
    const siparisler: NormalizeSiparis[] = [...gruplar].map(([no, satirKayitlari]) => {
      const ana = satirKayitlari[0]; const hamSatirlar = satirKayitlari.flatMap((k) => Array.isArray(k.lineItems) ? k.lineItems : Array.isArray(k.items) ? k.items : [k]);
      const satirlar = hamSatirlar.map((s: any, i: number) => ({ hariciSatirId: metin(s.lineItemId ?? s.id ?? `${no}-${i}`), sku: metin(s.merchantSku ?? s.merchantSKU ?? s.sku ?? s.hbSku), barkod: metin(s.barcode) || undefined, urunAdi: metin(s.productName ?? s.name ?? s.title) || "Hepsiburada ürünü", miktar: para(s.quantity ?? 1), birimFiyat: para(s.unitPrice ?? s.price), kdvOrani: para(s.vatRate ?? s.vat ?? 20) }));
      const toplam = para(ana.totalPrice ?? ana.totalAmount) || satirlar.reduce((t, s) => t + s.miktar * s.birimFiyat, 0);
      const adres = ana.shippingAddress ?? ana.deliveryAddress; const tarih = ana.orderDate ?? ana.createdDate ?? ana.purchaseDate;
      return { hariciId: metin(ana.id ?? ana.orderId ?? no), siparisNo: no, hariciDurum: metin(ana.status) || undefined, siparisTarihi: new Date(tarih).toISOString(), musteriUnvani: metin(ana.customerName ?? ana.recipientName ?? adres?.name) || "Hepsiburada müşterisi", musteriEposta: metin(ana.customerEmail ?? ana.email) || undefined, musteriTelefon: metin(ana.customerPhone ?? adres?.phone) || undefined, vknTckn: metin(ana.taxNumber ?? ana.identityNumber) || undefined, dovizCinsi: ["TRY", "USD", "EUR"].includes(ana.currency) ? ana.currency : "TRY", toplam, teslimatAdresi: adres, satirlar };
    }).filter((s) => s.satirlar.length > 0 && s.satirlar.every((x) => x.sku));
    return { siparisler, sonrakiImlec: kayitlar.length >= limit ? String(offset + limit) : null };
  }
}
