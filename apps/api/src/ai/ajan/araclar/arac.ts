import { createHash } from "node:crypto";
import { z } from "zod";
import type { UcCagirici, UcTanimi } from "../uc-cagirici";

/**
 * AI-03: aracın sınıfı tanımda sabittir; model değiştiremez.
 * - okuma: doğrudan çalışır
 * - taslak: taslak kayıt açar, doğrudan çalışır
 * - onay: işlem yapmaz, onay talebi açar; işlem kullanıcı onaylayınca çalışır
 * Silme aracı yoktur.
 */
/** AI-114: `arayuz` tarayıcıda çalışan eylem; yalnız web asistanında sunulur. */
export type AracSinifi = "okuma" | "taslak" | "onay" | "arayuz";

export interface AracBaglami {
  uc: UcCagirici;
  kaynak: "asistan" | "mcp" | "otomasyon";
  arac: string;
  /** Onaylanan talebin kimliği; denetim kaydına yazılır. */
  talepId?: string;
  /** AI-118: arka plan görevinde (AI-105) çalışıyor; büyük dosya sınırı geçerli. */
  arkaPlan?: boolean;
}

export interface OnayOnizlemesi {
  eylem: string;
  hedef: string;
  etkiler?: string[];
  degisiklikler?: Array<{ alan: string; once?: unknown; sonra: unknown }>;
}

export interface AjanAraci<G = any> {
  ad: string;
  aciklama: string;
  sinif: AracSinifi;
  girdi: z.ZodType<G>;
  /** Yetkinin okunduğu ana ekran ucu (AI-02); rol bu uca giremiyorsa araç modele sunulmaz. */
  uc: UcTanimi;
  /** okuma/taslak: hemen; onay: kullanıcı onayladıktan sonra çalışır. Dönen değer modele gider. */
  calistir(b: AracBaglami, girdi: G): Promise<unknown>;
  /** Yalnız onay sınıfı: yan etkisiz, insan okunur talep özeti (ne olacak, hangi kayıt, tutar). */
  ozetle?(b: AracBaglami, girdi: G): Promise<string>;
  /** Yalnız onay sınıfı: talep açılırken sabitlenen yapılandırılmış işlem planı/farkı. */
  onizle?(b: AracBaglami, girdi: G): Promise<OnayOnizlemesi>;
  /**
   * Yalnız onay sınıfı (AI-27): onayın bağlandığı kayıt içeriği. Talep açılırken
   * ve onayda okunur; özetler farklıysa kullanıcı görmediği içeriği onaylamış
   * olur, işlem yapılmaz.
   */
  hedefDurumu?(b: AracBaglami, girdi: G): Promise<unknown>;
}

function kararliJson(deger: unknown): string {
  if (deger === null || typeof deger !== "object") return JSON.stringify(deger) ?? "null";
  if (Array.isArray(deger)) return `[${deger.map(kararliJson).join(",")}]`;
  return `{${Object.entries(deger as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${kararliJson(v)}`).join(",")}}`;
}

/** AI-27: içeriğin anahtar sırasından bağımsız SHA-256 özeti (Decimal/Date JSON biçimiyle). */
export function icerikOzeti(deger: unknown): string {
  const duz: unknown = deger === undefined ? null : JSON.parse(JSON.stringify(deger));
  return createHash("sha256").update(kararliJson(duz)).digest("hex");
}

/**
 * AI-27: belge/fatura görünümünden onaya esas içerik — kayıt alanları ve satırlar.
 * İlişkili listeler (türetilen belgeler, ödemeler, e-Belge durumu) dışarıda kalır;
 * onlar bu işlemin içeriği değildir ve arka planda değişebilir.
 */
export function kayitIcerigi(kayit: Record<string, unknown>): Record<string, unknown> {
  const duz = JSON.parse(JSON.stringify(kayit)) as Record<string, unknown>;
  const icerik: Record<string, unknown> = Object.fromEntries(Object.entries(duz).filter(([, v]) => v === null || typeof v !== "object"));
  if (Array.isArray(duz.satirlar)) icerik.satirlar = duz.satirlar;
  return icerik;
}

export function arac<G>(tanim: AjanAraci<G>): AjanAraci<G> {
  if (tanim.sinif === "onay" && !tanim.ozetle) throw new Error(`${tanim.ad}: onaya tabi araç özet üretmeli`);
  return tanim;
}

/** Uç çağrısı; denetim kaydı için aracın adı ve kaynağı taşınır. */
export function cagir<T = any>(b: AracBaglami, uc: UcTanimi, argumanlar: unknown[], varlikId?: string | null): Promise<T> {
  return b.uc.cagir<T>(uc, argumanlar, { kaynak: b.kaynak, arac: b.arac, talepId: b.talepId, varlikId });
}

/** Nesneden yalnız istenen alanlar; modele giden çıktıyı küçük tutar. */
export function sec<T extends Record<string, any>>(nesne: T | null | undefined, alanlar: string[]): Record<string, unknown> {
  if (!nesne) return {};
  return Object.fromEntries(alanlar.filter((a) => nesne[a] !== undefined).map((a) => [a, nesne[a]]));
}

const AGIR_ALAN = /xml|base64|gorsel|pdf|html|imza|icerik$/i;

/**
 * AI-73…77: şekli araçta sabitlenmemiş uç çıktısını modele küçültür: ağır
 * alanlar (XML, görsel, PDF) atılır, diziler `dizi` öğeyle kesilir. Kesilen
 * dizi varsa `kisaltildi` true döner; araç bunu modele not olarak iletir.
 */
export function kisalt(deger: unknown, dizi = 20, derinlik = 5): { veri: unknown; kisaltildi: boolean } {
  let kisaltildi = false;
  const gez = (d: unknown, kat: number): unknown => {
    if (d === null || typeof d !== "object") return d;
    if (d instanceof Date) return d.toISOString();
    if (kat <= 0) return Array.isArray(d) ? `[${d.length} öğe]` : "{…}";
    if (Array.isArray(d)) {
      if (d.length > dizi) kisaltildi = true;
      return d.slice(0, dizi).map((x) => gez(x, kat - 1));
    }
    // Prisma Decimal ve benzeri sayı nesneleri metne çevrilir.
    if (typeof (d as { toFixed?: unknown }).toFixed === "function" && typeof (d as { toString?: unknown }).toString === "function" && !(d as object).constructor?.name?.startsWith("Object")) {
      return String(d);
    }
    return Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([k]) => !AGIR_ALAN.test(k)).map(([k, v]) => [k, gez(v, kat - 1)]));
  };
  return { veri: JSON.parse(JSON.stringify(gez(deger, derinlik))), kisaltildi };
}

export const uuid = (aciklama: string) => z.string().uuid().describe(aciklama);
export const tarih = (aciklama: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalıdır").describe(aciklama);
export const sayiMetni = (aciklama: string) =>
  z.union([z.number(), z.string()]).transform((d) => String(d).replace(",", ".")).describe(aciklama);

export const BUGUN = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

export const adres = {
  belge: (id: string) => `/panel/belgeler?odak=${id}`,
  fatura: (id: string) => `/panel/fatura?faturaId=${id}`,
  cari: (id: string) => `/panel/cari/${id}`,
  stok: (id: string) => `/panel/stok/${id}`,
  masraf: () => "/panel/masraflar",
  eposta: () => "/panel/eposta",
  gelenEfatura: (id: string) => `/panel/fatura/gelen-kutusu?ac=${id}`,
  gelenEirsaliye: () => "/panel/ebelge/irsaliye-gelen",
  satinAlma: (id: string) => `/panel/satin-alma/talepler?talep=${id}`,
  duzeltme: () => "/panel/islemler",
  crmFirsat: (id: string) => `/panel/crm/${id}`,
  uretimEmri: (id: string) => `/panel/uretim/emirler/${id}`,
  personel: (id: string) => `/panel/personel/${id}`,
  izinler: () => "/panel/personel/izinler",
  bilgiTalepleri: () => "/panel/personel/bilgi-talepleri",
};

export function para(deger: unknown, doviz = "TRY"): string {
  const sayi = Number(deger ?? 0);
  return `${sayi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
}
