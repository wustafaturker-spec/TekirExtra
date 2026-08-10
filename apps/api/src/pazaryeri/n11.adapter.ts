import type { NormalizeSiparis, PazaryeriConfig } from "./trendyol.adapter";

export class N11Adapter {
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
        const miktar = Number(s.quantity ?? 0); const faturaTutari = Number(s.sellerInvoiceAmount ?? (Number(s.price ?? 0) * miktar));
        return { hariciSatirId: String(s.orderLineId ?? `${p.orderNumber}-${i}`), sku: String(s.stockCode ?? ""), barkod: s.barcode ? String(s.barcode) : undefined, urunAdi: String(s.productName ?? "N11 ürünü"), miktar, birimFiyat: miktar ? faturaTutari / miktar : 0, kdvOrani: Number(s.vatRate ?? 20) };
      });
      const olusma = (Array.isArray(p.packageHistories) ? p.packageHistories : []).find((h: any) => String(h.status).trim().toLowerCase() === "created")?.createdDate ?? p.lastModifiedDate;
      const adres = p.shippingAddress; const toplam = satirlar.reduce((t, s) => t + s.miktar * s.birimFiyat, 0);
      return { hariciId: String(p.id ?? p.orderNumber), siparisNo: String(p.orderNumber), hariciDurum: p.shipmentPackageStatus, siparisTarihi: new Date(Number(olusma)).toISOString(), musteriUnvani: String(p.customerfullName ?? p.billingAddress?.fullName ?? "N11 müşterisi"), musteriEposta: p.customerEmail || undefined, musteriTelefon: adres?.gsm || undefined, vknTckn: p.taxId || p.tcIdentityNumber || undefined, dovizCinsi: "TRY" as const, toplam, teslimatAdresi: adres, satirlar };
    }).filter((s) => s.satirlar.length > 0 && s.satirlar.every((x) => x.sku && x.miktar > 0));
    const totalPages = Number(veri.totalPages ?? veri.pageCount ?? 0);
    return { siparisler, sonrakiImlec: page + 1 < totalPages ? String(page + 1) : null };
  }
}
