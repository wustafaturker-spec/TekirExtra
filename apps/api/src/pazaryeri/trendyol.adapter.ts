import { type DovizKodu, dovizKoduMu } from "@tekirextra/shared";
import { disFetch } from "../core/guvenlik/dis-istek";
import { DIGER_FINANS_TURLERI, SETTLEMENT_TURLERI, digerFinansKesintisi, settlementKesintileri, type TrendyolFinansKaydi } from "./trendyol-finans";

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
export interface PazaryeriConfig {
  kullaniciAdi: string; parola?: string; apiAnahtari?: string; saticiId?: string; magazaId?: string; servisAdresi?: string;
}
export interface NormalizeSiparis {
  hariciId: string; siparisNo: string; hariciDurum?: string; siparisTarihi: string;
  musteriUnvani: string; musteriEposta?: string; musteriTelefon?: string; vknTckn?: string;
  dovizCinsi: DovizKodu; toplam: number; teslimatAdresi?: Record<string, unknown>;
  /** PZR-01: birimFiyat KDV dahil, indirimler düşülmüş; PZR-03: kdvOrani gelmediyse null. */
  satirlar: { hariciSatirId: string; sku: string; barkod?: string; urunAdi: string; miktar: number; birimFiyat: number; kdvOrani: number | null }[];
}
export interface PazaryeriStokFiyat {
  sku: string; barkod: string; miktar: number; fiyat: number;
}
export interface NormalizeKesinti {
  hariciId: string; siparisNo?: string; tur: string; aciklama?: string; tarih: string;
  tutar: number; dovizCinsi: DovizKodu; hamVeri?: Record<string, unknown>;
}

export class TrendyolAdapter {
  /** PZR-15: finans sayfaları arası bekleme (ms); testte 0. 429 beklemesi de bununla ölçeklenir. */
  constructor(private readonly sayfaArasiMs = 250) {}

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
      vknTckn: p.taxNumber || p.identityNumber || undefined, dovizCinsi: dovizKoduMu(p.currencyCode) ? p.currencyCode : "TRY",
      toplam: Number(p.packageTotalPrice ?? 0), teslimatAdresi: p.shipmentAddress,
      satirlar: (Array.isArray(p.lines) ? p.lines : []).map((s: any) => ({ hariciSatirId: String(s.lineId), sku: String(s.stockCode), barkod: s.barcode || undefined, urunAdi: String(s.productName), miktar: Number(s.quantity), birimFiyat: s.lineUnitPrice != null ? Number(s.lineUnitPrice) : Number(s.lineGrossAmount ?? 0) - Number(s.lineTotalDiscount ?? 0), kdvOrani: s.vatRate != null ? Number(s.vatRate) : null })),
    })).filter((s: NormalizeSiparis) => s.satirlar.length > 0);
    return { siparisler, sonrakiImlec: veri.hasMore && veri.nextCursor ? String(veri.nextCursor) : null };
  }

  /**
   * PZR-15: bir pencere (≤ 15 gün) için cari hesap ekstresinden kesintiler.
   * Her tür ayrı sorgulanır (yanıttaki tür Türkçe etikettir); sayfa 1000.
   */
  async finansKesintileriCek(config: PazaryeriConfig, baslangic: number, bitis: number): Promise<{ kesintiler: NormalizeKesinti[]; istekSayisi: number }> {
    if (!config.saticiId || !config.parola) throw new Error("Trendyol satıcı ID ve API secret zorunludur");
    const kok = `https://apigw.trendyol.com/integration/finance/che/sellers/${encodeURIComponent(config.saticiId)}`;
    const basliklar = { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": `${config.saticiId} - TekirExtra`, Accept: "application/json" };
    let istekSayisi = 0;
    const sayfalar = async (servis: "settlements" | "otherfinancials", tur: string) => {
      const kayitlar: TrendyolFinansKaydi[] = [];
      for (let sayfa = 0; sayfa < 100; sayfa++) {
        const url = new URL(`${kok}/${servis}`);
        url.searchParams.set("transactionType", tur); url.searchParams.set("startDate", String(baslangic)); url.searchParams.set("endDate", String(bitis));
        // Belge yolda sellerId, tabloda supplierId istiyor; ikisi aynı satıcı numarasıdır.
        url.searchParams.set("supplierId", config.saticiId!); url.searchParams.set("page", String(sayfa)); url.searchParams.set("size", "1000");
        let yanit: Response | null = null;
        for (let deneme = 0; deneme < 4; deneme++) {
          istekSayisi++;
          yanit = await disFetch(url, { headers: basliklar, signal: AbortSignal.timeout(30_000) });
          if (yanit.status !== 429 && yanit.status < 500) break;
          const sonra = Number(yanit.headers.get("retry-after"));
          const olcek = this.sayfaArasiMs / 250;
          await bekle(olcek * (Number.isFinite(sonra) && sonra > 0 ? Math.min(sonra, 30) * 1000 : 2000 * 2 ** deneme));
        }
        if (!yanit!.ok) throw new Error(`Trendyol finans servisi (${servis} ${tur}) HTTP ${yanit!.status}`);
        const veri = await yanit!.json() as { content?: TrendyolFinansKaydi[]; totalPages?: number };
        kayitlar.push(...(Array.isArray(veri.content) ? veri.content : []));
        await bekle(this.sayfaArasiMs);
        if (sayfa + 1 >= Number(veri.totalPages ?? 0)) break;
      }
      return kayitlar;
    };
    const kesintiler: NormalizeKesinti[] = [];
    for (const tur of SETTLEMENT_TURLERI) for (const k of await sayfalar("settlements", tur)) kesintiler.push(...settlementKesintileri(tur, k));
    for (const tur of DIGER_FINANS_TURLERI) for (const k of await sayfalar("otherfinancials", tur)) { const x = digerFinansKesintisi(tur, k); if (x) kesintiler.push(x); }
    return { kesintiler, istekSayisi };
  }
}
