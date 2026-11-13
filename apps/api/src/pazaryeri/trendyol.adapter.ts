import { type DovizKodu, dovizKoduMu } from "@tekirextra/shared";
import { disFetch } from "../core/guvenlik/dis-istek";
import { DIGER_FINANS_TURLERI, SETTLEMENT_TURLERI, digerFinansKesintisi, settlementKesintileri, type TrendyolFinansKaydi } from "./trendyol-finans";

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PZR-16: Trendyol ödeme emri (payment-order). */
export interface TrendyolOdemeEmri { id: string | number; status?: string; amount?: number; payoutDate?: number; paymentType?: string; [alan: string]: unknown }
export interface PazaryeriConfig {
  kullaniciAdi: string; parola?: string; apiAnahtari?: string; saticiId?: string; magazaId?: string; servisAdresi?: string;
  /** PZR-21: Hepsiburada entegratör adı (User-Agent). */
  entegratorAdi?: string;
}
export interface NormalizeSiparis {
  hariciId: string; siparisNo: string; hariciDurum?: string; siparisTarihi: string;
  musteriUnvani: string; musteriEposta?: string; musteriTelefon?: string; vknTckn?: string;
  dovizCinsi: DovizKodu; toplam: number; teslimatAdresi?: Record<string, unknown>;
  /** PZR-01: birimFiyat KDV dahil, indirimler düşülmüş; PZR-03: kdvOrani gelmediyse null. */
  satirlar: { hariciSatirId: string; sku: string; barkod?: string; urunAdi: string; miktar: number; birimFiyat: number; kdvOrani: number | null }[];
}
export interface PazaryeriStokFiyat {
  sku: string; barkod: string; miktar: number;
  /**
   * KDV dahil satış fiyatı. Stok kartındaki fiyat KDV hariçtir; servis kartın oranıyla KDV dahile
   * çevirir, adaptörler olduğu gibi gönderir (pazaryerleri ve siteler müşteriye görünen fiyatı ister).
   */
  fiyat: number;
}
export interface NormalizeKesinti {
  hariciId: string; siparisNo?: string; tur: string; aciklama?: string; tarih: string;
  tutar: number; dovizCinsi: DovizKodu; hamVeri?: Record<string, unknown>;
  /** PZR-16: pazaryerinin ödeme numarası (Trendyol paymentOrderId). */
  odemeNo?: string;
  /** PZR-21: sağlayıcının bilinen kod eşlemesinden gelen sınıf (kullanıcı kuralı önce gelir). */
  sinif?: import("./pazaryeri-kesinti-sinifi").KesintiSinifi;
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
    const r = await this.finansKayitlari(config, { startDate: String(baslangic), endDate: String(bitis) });
    return { kesintiler: r.kesintiler, istekSayisi: r.istekSayisi };
  }

  /**
   * PZR-16: bir ödeme döneminin kalemleri (`paymentOrderId` ile): kesintiler ve
   * ödemeye giren paketler (sipariş no + paket no; siparişe ödeme no yazmak için).
   */
  async odemeKalemleriCek(config: PazaryeriConfig, odemeNo: string): Promise<{ kesintiler: NormalizeKesinti[]; paketler: { siparisNo: string; paketNo: string | null }[]; istekSayisi: number }> {
    const r = await this.finansKayitlari(config, { paymentOrderId: odemeNo });
    // Ödeme numarası yanıtta yoksa bile dönemin kalemidir.
    return { ...r, kesintiler: r.kesintiler.map((k) => ({ ...k, odemeNo })) };
  }

  /** PZR-16: ödeme emirleri (sayfa en çok 10); `sinir` tarihinden eski ödemeye gelince durur. */
  async odemeEmirleriCek(config: PazaryeriConfig, sinir: number): Promise<{ odemeler: TrendyolOdemeEmri[]; istekSayisi: number }> {
    const odemeler: TrendyolOdemeEmri[] = []; let istekSayisi = 0;
    for (let sayfa = 0; sayfa < 50; sayfa++) {
      const url = new URL(`${this.finansKoku(config)}/payment-order`);
      url.searchParams.set("page", String(sayfa)); url.searchParams.set("size", "10");
      const veri = await this.finansGetir(config, url, "payment-order", () => istekSayisi++) as { content?: TrendyolOdemeEmri[]; totalPages?: number };
      const icerik = Array.isArray(veri.content) ? veri.content : [];
      odemeler.push(...icerik.filter((o) => Number(o.payoutDate ?? 0) >= sinir));
      if (!icerik.length || icerik.every((o) => Number(o.payoutDate ?? 0) < sinir) || sayfa + 1 >= Number(veri.totalPages ?? 0)) break;
    }
    return { odemeler, istekSayisi };
  }

  private finansKoku(config: PazaryeriConfig) {
    if (!config.saticiId || !config.parola) throw new Error("Trendyol satıcı ID ve API secret zorunludur");
    return `https://apigw.trendyol.com/integration/finance/che/sellers/${encodeURIComponent(config.saticiId)}`;
  }

  /** Tek GET: 30 sn zaman aşımı, 429/5xx'te Retry-After ya da üstel bekleme (4 deneme), ardından sayfa arası bekleme. */
  private async finansGetir(config: PazaryeriConfig, url: URL, ad: string, sayac: () => void): Promise<unknown> {
    const basliklar = { Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`, "User-Agent": `${config.saticiId} - TekirExtra`, Accept: "application/json" };
    let yanit: Response | null = null;
    for (let deneme = 0; deneme < 4; deneme++) {
      sayac();
      yanit = await disFetch(url, { headers: basliklar, signal: AbortSignal.timeout(30_000) });
      if (yanit.status !== 429 && yanit.status < 500) break;
      const sonra = Number(yanit.headers.get("retry-after"));
      const olcek = this.sayfaArasiMs / 250;
      await bekle(olcek * (Number.isFinite(sonra) && sonra > 0 ? Math.min(sonra, 30) * 1000 : 2000 * 2 ** deneme));
    }
    if (!yanit!.ok) throw new Error(`Trendyol finans servisi (${ad}) HTTP ${yanit!.status}`);
    const veri = await yanit!.json();
    await bekle(this.sayfaArasiMs);
    return veri;
  }

  /** Her tür ayrı sorgulanır (yanıttaki tür Türkçe etikettir); sayfa 1000. */
  private async finansKayitlari(config: PazaryeriConfig, filtre: Record<string, string>) {
    const kok = this.finansKoku(config);
    let istekSayisi = 0;
    const sayfalar = async (servis: "settlements" | "otherfinancials", tur: string) => {
      const kayitlar: TrendyolFinansKaydi[] = [];
      for (let sayfa = 0; sayfa < 100; sayfa++) {
        const url = new URL(`${kok}/${servis}`);
        url.searchParams.set("transactionType", tur);
        for (const [a, d] of Object.entries(filtre)) url.searchParams.set(a, d);
        // Belge yolda sellerId, tabloda supplierId istiyor; ikisi aynı satıcı numarasıdır.
        url.searchParams.set("supplierId", config.saticiId!); url.searchParams.set("page", String(sayfa)); url.searchParams.set("size", "1000");
        const veri = await this.finansGetir(config, url, `${servis} ${tur}`, () => istekSayisi++) as { content?: TrendyolFinansKaydi[]; totalPages?: number };
        kayitlar.push(...(Array.isArray(veri.content) ? veri.content : []));
        if (sayfa + 1 >= Number(veri.totalPages ?? 0)) break;
      }
      return kayitlar;
    };
    const kesintiler: NormalizeKesinti[] = [];
    const paketler = new Map<string, { siparisNo: string; paketNo: string | null }>();
    for (const tur of SETTLEMENT_TURLERI) for (const k of await sayfalar("settlements", tur)) {
      kesintiler.push(...settlementKesintileri(tur, k));
      if ((tur === "Sale" || tur === "Return") && k.orderNumber != null) {
        const paketNo = k.shipmentPackageId != null ? String(k.shipmentPackageId) : null;
        paketler.set(`${k.orderNumber}|${paketNo ?? ""}`, { siparisNo: String(k.orderNumber), paketNo });
      }
    }
    for (const tur of DIGER_FINANS_TURLERI) for (const k of await sayfalar("otherfinancials", tur)) { const x = digerFinansKesintisi(tur, k); if (x) kesintiler.push(x); }
    return { kesintiler, paketler: [...paketler.values()], istekSayisi };
  }
}
