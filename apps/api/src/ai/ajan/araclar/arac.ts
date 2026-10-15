import { z } from "zod";
import type { UcCagirici, UcTanimi } from "../uc-cagirici";

/**
 * AI-03: aracın sınıfı tanımda sabittir; model değiştiremez.
 * - okuma: doğrudan çalışır
 * - taslak: taslak kayıt açar, doğrudan çalışır
 * - onay: işlem yapmaz, onay talebi açar; işlem kullanıcı onaylayınca çalışır
 * Silme aracı yoktur.
 */
export type AracSinifi = "okuma" | "taslak" | "onay";

export interface AracBaglami {
  uc: UcCagirici;
  kaynak: "asistan" | "mcp";
  arac: string;
  /** Onaylanan talebin kimliği; denetim kaydına yazılır. */
  talepId?: string;
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
};

export function para(deger: unknown, doviz = "TRY"): string {
  const sayi = Number(deger ?? 0);
  return `${sayi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;
}
