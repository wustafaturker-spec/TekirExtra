export interface PazaryeriConfig {
  kullaniciAdi: string; parola?: string; apiAnahtari?: string; saticiId?: string; magazaId?: string; servisAdresi?: string;
}
export interface NormalizeSiparis {
  hariciId: string; siparisNo: string; hariciDurum?: string; siparisTarihi: string;
  musteriUnvani: string; musteriEposta?: string; musteriTelefon?: string; vknTckn?: string;
  dovizCinsi: "TRY" | "USD" | "EUR"; toplam: number; teslimatAdresi?: Record<string, unknown>;
  satirlar: { hariciSatirId: string; sku: string; barkod?: string; urunAdi: string; miktar: number; birimFiyat: number; kdvOrani: number }[];
}
export interface PazaryeriStokFiyat {
  sku: string; barkod: string; miktar: number; fiyat: number;
}
export interface NormalizeKesinti {
  hariciId: string; siparisNo?: string; tur: string; aciklama?: string; tarih: string;
  tutar: number; dovizCinsi: "TRY" | "USD" | "EUR"; hamVeri?: Record<string, unknown>;
}

export class TrendyolAdapter {
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[] }> {
    if (!config.saticiId || !config.parola) throw new Error("Trendyol satıcı ID ve API secret zorunludur");
    const islemIdleri: string[] = [];
    for (let baslangic = 0; baslangic < kalemler.length; baslangic += 1000) {
      const parca = kalemler.slice(baslangic, baslangic + 1000);
      const url = `https://apigw.trendyol.com/integration/inventory/sellers/${encodeURIComponent(config.saticiId)}/products/price-and-inventory`;
      const yanit = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": `${config.saticiId} - TekirExtra`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: parca.map((k) => ({ barcode: k.barkod, quantity: Math.min(20000, Math.max(0, Math.floor(k.miktar))), salePrice: k.fiyat, listPrice: k.fiyat })) }),
      });
      if (!yanit.ok) throw new Error(`Trendyol stok/fiyat servisi HTTP ${yanit.status}`);
      const veri = await yanit.json() as { batchRequestId?: string };
      if (!veri.batchRequestId) throw new Error("Trendyol stok/fiyat işlemi batchRequestId dönmedi");
      islemIdleri.push(veri.batchRequestId);
    }
    return { gonderilen: kalemler.length, islemIdleri };
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ siparisler: NormalizeSiparis[]; sonrakiImlec: string | null }> {
    if (!config.saticiId || !config.parola) throw new Error("Trendyol satıcı ID ve API secret zorunludur");
    const url = new URL(`https://apigw.trendyol.com/integration/order/sellers/${encodeURIComponent(config.saticiId)}/orders/stream`);
    url.searchParams.set("size", "50"); if (imlec) url.searchParams.set("nextCursor", imlec);
    const yanit = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": `${config.saticiId} - TekirExtra`, Accept: "application/json" } });
    if (!yanit.ok) throw new Error(`Trendyol sipariş servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any;
    const siparisler = (Array.isArray(veri.content) ? veri.content : []).map((p: any): NormalizeSiparis => ({
      hariciId: String(p.shipmentPackageId), siparisNo: String(p.orderNumber), hariciDurum: p.status ?? p.shipmentPackageStatus,
      siparisTarihi: new Date(Number(p.orderDate)).toISOString(), musteriUnvani: [p.customerFirstName, p.customerLastName].filter(Boolean).join(" ") || p.invoiceAddress?.company || "Pazaryeri müşterisi",
      musteriEposta: p.customerEmail || undefined, musteriTelefon: p.shipmentAddress?.phone || undefined,
      vknTckn: p.taxNumber || p.identityNumber || undefined, dovizCinsi: ["TRY", "USD", "EUR"].includes(p.currencyCode) ? p.currencyCode : "TRY",
      toplam: Number(p.packageTotalPrice ?? 0), teslimatAdresi: p.shipmentAddress,
      satirlar: (Array.isArray(p.lines) ? p.lines : []).map((s: any) => ({ hariciSatirId: String(s.lineId), sku: String(s.stockCode), barkod: s.barcode || undefined, urunAdi: String(s.productName), miktar: Number(s.quantity), birimFiyat: Number(s.lineUnitPrice ?? s.lineGrossAmount ?? 0), kdvOrani: Number(s.vatRate ?? 20) })),
    })).filter((s: NormalizeSiparis) => s.satirlar.length > 0);
    return { siparisler, sonrakiImlec: veri.hasMore && veri.nextCursor ? String(veri.nextCursor) : null };
  }
}
