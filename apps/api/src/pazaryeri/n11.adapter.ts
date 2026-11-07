import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

export class N11Adapter {
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[] }> {
    if (!config.parola) throw new Error("N11 app key ve app secret zorunludur");
    const islemIdleri: string[] = [];
    for (let baslangic = 0; baslangic < kalemler.length; baslangic += 1000) {
      const parca = kalemler.slice(baslangic, baslangic + 1000);
      const yanit = await fetch("https://api.n11.com/ms/product/tasks/price-stock-update", {
        method: "POST", headers: { appkey: config.kullaniciAdi, appsecret: config.parola, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "TekirExtra/1.0" },
        body: JSON.stringify({ payload: { integrator: "TekirExtra", skus: parca.map((k) => ({ stockCode: k.sku, listPrice: Number(k.fiyat.toFixed(2)), salePrice: Number(k.fiyat.toFixed(2)), quantity: Math.max(0, Math.floor(k.miktar)), currencyType: "TL" })) } }),
      });
      if (!yanit.ok) throw new Error(`N11 stok/fiyat servisi HTTP ${yanit.status}`);
      const veri = await yanit.json() as { id?: string | number; status?: string; reasons?: string[] };
      if (!veri.id || veri.status === "REJECT") throw new Error(`N11 stok/fiyat işlemi reddedildi${veri.reasons?.length ? `: ${veri.reasons.join("; ")}` : ""}`);
      islemIdleri.push(String(veri.id));
    }
    return { gonderilen: kalemler.length, islemIdleri };
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<{ siparisler: NormalizeSiparis[]; sonrakiImlec: string | null }> {
    if (!config.kullaniciAdi || !config.parola) throw new Error("N11 appkey ve appsecret zorunludur");
    const page = Math.max(0, Number(imlec ?? 0) || 0);
    const url = new URL("https://api.n11.com/rest/delivery/v1/shipmentPackages");
    url.searchParams.set("status", "Created"); url.searchParams.set("orderByField", "true"); url.searchParams.set("orderByDirection", "ASC"); url.searchParams.set("page", String(page)); url.searchParams.set("size", "100");
    const yanit = await fetch(url, { headers: { appkey: config.kullaniciAdi, appsecret: config.parola, Accept: "application/json" } });
    if (!yanit.ok) throw new Error(`N11 sipariş servisi HTTP ${yanit.status}`);
    const veri = await yanit.json() as any; const content: any[] = Array.isArray(veri.content) ? veri.content : [];
    const siparisler: NormalizeSiparis[] = content.map((p: any): NormalizeSiparis => {
      const satirlar: NormalizeSiparis["satirlar"] = (Array.isArray(p.lines) ? p.lines : []).map((s: any, i: number) => {
        const miktar = Number(s.quantity ?? 0); // PZR-05: sellerInvoiceAmount "Mağaza fatura tutarı"dır; yoksa mağaza indirimi düşülür (n11 indirimi n11'in karşıladığıdır).
        const faturaTutari = s.sellerInvoiceAmount != null ? Number(s.sellerInvoiceAmount) : Number(s.price ?? 0) * miktar - Number(s.sellerDiscount ?? 0);
        return { hariciSatirId: String(s.orderLineId ?? `${p.orderNumber}-${i}`), sku: String(s.stockCode ?? ""), barkod: s.barcode ? String(s.barcode) : undefined, urunAdi: String(s.productName ?? "N11 ürünü"), miktar, birimFiyat: miktar ? faturaTutari / miktar : 0, kdvOrani: s.vatRate != null ? Number(s.vatRate) : null };
      });
      const olusma = (Array.isArray(p.packageHistories) ? p.packageHistories : []).find((h: any) => String(h.status).trim().toLowerCase() === "created")?.createdDate ?? p.lastModifiedDate;
      const adres = p.shippingAddress; const toplam = satirlar.reduce((t, s) => t + s.miktar * s.birimFiyat, 0);
      return { hariciId: String(p.id ?? p.orderNumber), siparisNo: String(p.orderNumber), hariciDurum: p.shipmentPackageStatus, siparisTarihi: new Date(Number(olusma)).toISOString(), musteriUnvani: String(p.customerfullName ?? p.billingAddress?.fullName ?? "N11 müşterisi"), musteriEposta: p.customerEmail || undefined, musteriTelefon: adres?.gsm || undefined, vknTckn: p.taxId || p.tcIdentityNumber || undefined, dovizCinsi: "TRY" as const, toplam, teslimatAdresi: adres, satirlar };
    }).filter((s) => s.satirlar.length > 0 && s.satirlar.every((x) => x.sku && x.miktar > 0));
    const totalPages = Number(veri.totalPages ?? veri.pageCount ?? 0);
    return { siparisler, sonrakiImlec: page + 1 < totalPages ? String(page + 1) : null };
  }
}
