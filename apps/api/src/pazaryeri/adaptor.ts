import { AmazonAdapter } from "./amazon.adapter";
import { HepsiburadaAdapter } from "./hepsiburada.adapter";
import { IkasAdapter } from "./ikas.adapter";
import { N11Adapter } from "./n11.adapter";
import { ShopifyAdapter } from "./shopify.adapter";
import { TicimaxAdapter } from "./ticimax.adapter";
import { TrendyolAdapter, type NormalizeSiparis, type PazaryeriConfig, type PazaryeriStokFiyat } from "./trendyol.adapter";
import { WooCommerceAdapter } from "./woocommerce.adapter";

/**
 * ETC-03: pazaryeri ve e-ticaret sitesi adaptörlerinin ortak arayüzü. Sipariş ve stok/fiyat akışı
 * bu arayüzden yürür; finans (kesinti, hakediş) pazaryerine özgü kalır.
 */
export interface SiparisSayfasi {
  siparisler: NormalizeSiparis[];
  /** Bir sonraki çalıştırmada kullanılacak konum; sona gelindiğinde de saklanır (zaman tabanlı imleç). */
  sonrakiImlec: string | null;
  /**
   * Bu çalıştırmada başka sayfa var mı. Verilmezse eski davranış: imleç doluysa devam (Trendyol akışı).
   * Zaman tabanlı adaptörler son sayfada `false` döner ama imleci (son değişiklik zamanı) yine verir.
   */
  devamVar?: boolean;
}

export interface PazaryeriAdaptoru {
  siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi>;
  stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan?: number }>;
  /** ETC-13: bağlantı sınaması — kimlik doğrulanır, varsa son sipariş okunur (kayıt yazılmaz). */
  sina?(config: PazaryeriConfig): Promise<{ mesaj: string }>;
  /** Stok/fiyat gönderiminde barkodsuz kalemler atlanır (Trendyol). */
  readonly barkodZorunlu?: boolean;
}

type Fabrika = () => PazaryeriAdaptoru;

/** Sağlayıcı kodu → adaptör. Yeni platform: adaptör + buraya bir satır + katalog kaydı. */
const ADAPTORLER: Record<string, Fabrika> = {
  trendyol: () => Object.assign(new TrendyolAdapter(), { barkodZorunlu: true }),
  hepsiburada: () => new HepsiburadaAdapter(),
  n11: () => new N11Adapter(),
  amazon_tr: () => new AmazonAdapter(),
  woocommerce: () => new WooCommerceAdapter(),
  shopify: () => new ShopifyAdapter(),
  ikas: () => new IkasAdapter(),
  ticimax: () => new TicimaxAdapter(),
};

export function adaptorCoz(saglayici: string): PazaryeriAdaptoru | null {
  return ADAPTORLER[saglayici]?.() ?? null;
}

export const ADAPTORLU_SAGLAYICILAR = Object.keys(ADAPTORLER);
