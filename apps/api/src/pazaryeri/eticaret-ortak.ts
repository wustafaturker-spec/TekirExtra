import { type DovizKodu, dovizKoduMu } from "@tekirextra/shared";
import { disFetch } from "../core/guvenlik/dis-istek";
import type { NormalizeSiparis } from "./trendyol.adapter";

/**
 * ETC-04/08…11: e-ticaret sitesi adaptörlerinin ortak kuralları.
 * - İmleç zaman tabanlıdır: son görülen değişiklik zamanı (+ sayfa/cursor). İlk çekim son 30 gün.
 * - Satır birim fiyatı KDV dahil ve indirimler düşülmüş verilir (pazaryeriyle aynı sözleşme, PZR-01).
 * - Kargo ve ek ücretler ayrı satırdır (SKU `KARGO` / `EK-UCRET`): fatura toplamı siparişle kuruşuna
 *   tutmalı; firma bu kodla hizmet kartı açarsa kendiliğinden eşleşir, yoksa elle eşlenir.
 */
export const KARGO_SKU = "KARGO";
export const EK_UCRET_SKU = "EK-UCRET";
export const ILK_CEKIM_GUN = 30;
export const IPTAL_DURUMU = "cancelled";

export interface ZamanImleci { sonra: string; sayfa?: number; cursor?: string | null; enSon?: string }

export function imlecOku(imlec: string | null | undefined, simdi = new Date()): ZamanImleci {
  if (imlec) {
    try {
      const v = JSON.parse(imlec) as ZamanImleci;
      if (v && typeof v.sonra === "string" && !Number.isNaN(Date.parse(v.sonra))) return v;
    } catch { /* eski ya da bozuk imleç: baştan */ }
  }
  return { sonra: new Date(simdi.getTime() - ILK_CEKIM_GUN * 86_400_000).toISOString() };
}

export const imlecYaz = (v: ZamanImleci) => JSON.stringify(v);

/** İki ISO zamanından geç olanı. */
export function enGec(a: string | undefined, b: string | null | undefined): string | undefined {
  if (!b || Number.isNaN(Date.parse(b))) return a;
  if (!a) return new Date(b).toISOString();
  return Date.parse(b) > Date.parse(a) ? new Date(b).toISOString() : a;
}

export const kurus = (n: number) => Math.round(n * 100) / 100;

/** ETC-06: kartın satış fiyatı KDV hariçtir; sitelerde fiyat KDV dahil gösterilir. */
export function kdvDahilFiyat(k: { fiyat: number; kdvOrani?: number }): number {
  return kurus(k.fiyat * (1 + (k.kdvOrani ?? 0) / 100));
}
const sayi = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export { sayi };

/** KDV oranı: tutardan türetilen oran yakın standart orana yuvarlanır; belirsizse null (stok kartının oranı). */
export function kdvOraniTuret(netTutar: number, kdvTutari: number): number | null {
  if (!(netTutar > 0) || !(kdvTutari > 0)) return null;
  const oran = (kdvTutari / netTutar) * 100;
  const standart = [1, 8, 10, 18, 20].find((o) => Math.abs(o - oran) <= 0.6);
  return standart ?? Math.round(oran);
}

export function doviz(kod: unknown): DovizKodu {
  const k = String(kod ?? "TRY").trim().toUpperCase().replace(/^(TL|YTL|₺)$/, "TRY");
  return dovizKoduMu(k) ? k : "TRY";
}

/** Serbest alanlardan (meta, not) 10 haneli VKN ya da 11 haneli TCKN. */
export function vknTcknBul(...adaylar: unknown[]): string | undefined {
  for (const a of adaylar) {
    const m = String(a ?? "").replace(/\s/g, "").match(/^\d{10,11}$/);
    if (m) return m[0];
  }
  return undefined;
}

/** Satırların KDV dahil toplamını siparişin toplamına göre sınar (eksik kalem varsa adaptör uyarır). */
export function satirToplami(s: NormalizeSiparis["satirlar"]): number {
  return kurus(s.reduce((t, x) => t + x.birimFiyat * x.miktar, 0));
}

/**
 * Site adresi (WooCommerce, Ticimax): https, sondaki eğik çizgi atılır. Biçim denetimi kayıtta
 * (`disAdresHatasi`), IP denetimi her istekte `disFetch` ile yapılır (ETC-07).
 */
export function siteKoku(adres: string | undefined): string {
  const a = (adres ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(a)) throw new Error("Site adresi https:// ile başlamalıdır");
  return a;
}

/** Zaman aşımlı, iç ağa gidemeyen istek; hata durumunda gövdenin başı mesaja eklenir. */
export async function guvenliIstek(url: string, secenek: RequestInit & { zamanAsimiMs?: number } = {}): Promise<Response> {
  const { zamanAsimiMs = 30_000, ...gercek } = secenek;
  return disFetch(url, { ...gercek, signal: AbortSignal.timeout(zamanAsimiMs) });
}

export async function jsonVeyaHata<T>(yanit: Response, kaynak: string): Promise<T> {
  if (!yanit.ok) {
    const govde = (await yanit.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    if (yanit.status === 401 || yanit.status === 403) throw new Error(`${kaynak}: kimlik doğrulanamadı (HTTP ${yanit.status}); anahtarı ve izinleri kontrol edin`);
    throw new Error(`${kaynak}: HTTP ${yanit.status}${govde ? ` · ${govde}` : ""}`);
  }
  return yanit.json() as Promise<T>;
}

/** Süreli erişim anahtarı önbelleği (Shopify istemci kimliği, ikas). Bitimden 2 dk önce yenilenir. */
const anahtarlar = new Map<string, { deger: string; bitis: number }>();
export async function onbellekliAnahtar(kimlik: string, al: () => Promise<{ deger: string; saniye: number }>): Promise<string> {
  const k = anahtarlar.get(kimlik);
  if (k && k.bitis > Date.now()) return k.deger;
  const yeni = await al();
  anahtarlar.set(kimlik, { deger: yeni.deger, bitis: Date.now() + Math.max(60, yeni.saniye - 120) * 1000 });
  return yeni.deger;
}
export function anahtarOnbelleginiSil() { anahtarlar.clear(); }
