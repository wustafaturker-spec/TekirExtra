import { disFetch } from "../core/guvenlik/dis-istek";
/**
 * KSB-30: banka hareketi sağlayıcıları için ortak altyapı.
 *
 * Senkronizasyon, otomatik çekim, idempotent kayıt, hata sayacı, bakiye uyarısı
 * ve ekstre kutusu sağlayıcıdan bağımsızdır; bir toplayıcı (Vomsis vb.) ya da
 * bankanın kendi API'si yalnız {@link BankaSaglayicisi} arayüzünü uygulayan bir
 * adaptörle eklenir ve {@link BANKA_SAGLAYICILARI} kaydına yazılır.
 * Ayrıntı: docs/BANKA-SAGLAYICI-EKLEME.md
 */

/** Sağlayıcının ekstre kutusuna verdiği hareket. */
export interface SaglayiciHareketi {
  /** Sağlayıcı tarafında hesap içinde benzersiz kimlik; idempotency anahtarıdır. */
  id: string;
  /** Hareketin Türkiye günü (YYYY-AA-GG). */
  tarih: string;
  /** Artı = hesaba giriş, eksi = çıkış. */
  tutar: number;
  aciklama: string;
  dekontNo?: string;
  karsiIban?: string;
  karsiUnvan?: string;
  /** Hareket sonrası banka bakiyesi; bakiye uyarısı bununla çalışır. */
  bakiye?: number;
}

export interface SaglayiciHesabi {
  id: string;
  ad: string;
  iban?: string | null;
  /** ISO kodu; TL → TRY. */
  dovizCinsi: string;
  bankaAdi?: string | null;
}

export interface HareketAraligi {
  baslangic: Date;
  bitis: Date;
  /** Önceki çekimin döndürdüğü imleç; artımlı çekim için. */
  imlec?: string | null;
}

export interface BankaSaglayicisi {
  /** `baglantilar.saglayici` değeri. */
  readonly kod: string;
  readonly ad: string;
  /** Şifreli bağlantı ayarının çözülmüş hâli (kullaniciAdi, parola, servisAdresi…). */
  hesaplar(ayar: Record<string, unknown>): Promise<SaglayiciHesabi[]>;
  hareketler(ayar: Record<string, unknown>, disHesapId: string, aralik: HareketAraligi): Promise<{ hareketler: SaglayiciHareketi[]; imlec: string | null }>;
}

/** Sağlayıcı kimlik bilgisini reddetti (4xx); yeniden denemek düzeltmez, otomatik çekim durur. */
export class SaglayiciKimlikHatasi extends Error {}

/* ─── HTTP: zaman aşımı ve yeniden deneme ─────────────────────────────────── */

export const BANKA_HTTP = {
  /** Tek isteğin en uzun süresi; aşılırsa istek kesilir. */
  zamanAsimiMs: 30_000,
  /** Geçici hatada toplam deneme sayısı. */
  deneme: 3,
  /** Denemeler arası bekleme (testlerde değiştirilir). */
  bekle: (ms: number) => new Promise<void>((tamam) => setTimeout(tamam, ms)),
};

const geciciMi = (durum: number) => durum === 429 || durum >= 500;

/** Retry-After (saniye) varsa o, yoksa 1 sn, 3 sn…; en çok 30 sn beklenir. */
function beklemeSuresi(yanit: { headers?: { get?: (ad: string) => string | null } } | null, deneme: number): number {
  const baslik = Number(yanit?.headers?.get?.("retry-after"));
  const ms = Number.isFinite(baslik) && baslik > 0 ? baslik * 1000 : 1000 * 3 ** (deneme - 1);
  return Math.min(ms, 30_000);
}

/**
 * Sağlayıcıya istek: her deneme {@link BANKA_HTTP.zamanAsimiMs} ile sınırlıdır
 * (asılı kalan istek otomatik çekim döngüsünü bütün kiracılar için durduruyordu).
 * Ağ hatası, zaman aşımı, 429 ve 5xx yeniden denenir; son denemenin yanıtı
 * çağırana döner, çağıran durumu yorumlar.
 */
export async function bankaIstegi(saglayici: string, url: string, init: RequestInit = {}): Promise<Response> {
  let sonHata: unknown;
  for (let deneme = 1; deneme <= BANKA_HTTP.deneme; deneme++) {
    try {
      const yanit = await disFetch(url, { ...init, signal: AbortSignal.timeout(BANKA_HTTP.zamanAsimiMs) });
      if (!geciciMi(yanit.status) || deneme === BANKA_HTTP.deneme) return yanit;
      await BANKA_HTTP.bekle(beklemeSuresi(yanit, deneme));
    } catch (hata) {
      sonHata = hata;
      if (deneme === BANKA_HTTP.deneme) break;
      await BANKA_HTTP.bekle(beklemeSuresi(null, deneme));
    }
  }
  const zamanAsimi = sonHata instanceof Error && (sonHata.name === "TimeoutError" || sonHata.name === "AbortError");
  throw new Error(zamanAsimi
    ? `${saglayici} ${BANKA_HTTP.zamanAsimiMs / 1000} saniyede yanıt vermedi (${BANKA_HTTP.deneme} deneme)`
    : `${saglayici} hizmetine ulaşılamadı: ${sonHata instanceof Error ? sonHata.message : String(sonHata)}`);
}

/* ─── Türkiye günü ──────────────────────────────────────────────────────── */

/** Anın Türkiye duvar saatindeki takvim alanları (UTC+3 sabit; sunucu saat diliminden bağımsız). */
export function trTarihParcalari(an: Date): { gun: number; ay: number; yil: number } {
  const d = new Date(an.getTime() + 3 * 3600000);
  return { gun: d.getUTCDate(), ay: d.getUTCMonth() + 1, yil: d.getUTCFullYear() };
}
