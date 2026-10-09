/**
 * Firmanın tevkifat tablosu (MVZ-09/12, karar 2026-10-09; FTR-35'in yerini alır).
 *
 * Tevkifat kodları ve oranları Mevzuat Merkezi'nde merkezi, yürürlük tarihli
 * tutulur; firma oran, ad ya da kod değiştiremez. Firmaya kalan tek tercih
 * kullanmadığı kodu kendi listesinden **gizlemek**tir: gizli kod yeni satırda
 * seçilemez, gelen e-Faturada yine tanınır.
 *
 * `TEVKIFAT_KODLARI` yalnız merkezin ilk dolumu ve merkez okunamayan
 * ortamlar (birim testleri) içindir.
 */
import type { TevkifatKodu } from "./gib-kodlari";

/** Merkezi kayıt: anahtar = GİB kodu, değer = { ad, oranlar }. */
export interface TevkifatMerkezKaydi {
  anahtar: string;
  deger: unknown;
}

/** Firma ayarı (`tevkifat` modülü): gizlenen kodlar. */
export interface TevkifatFirmaAyari {
  gizli?: string[];
  /** FTR-35'ten kalan biçim: yalnız `pasif` işaretleri gizli sayılır, oran/ad değişiklikleri yok sayılır (MVZ-15). */
  degisiklikler?: { kod: string; pasif?: boolean }[];
}

/** FTR-35 biçimindeki ayarı da okuyarak gizli kod listesini verir. */
export function gizliTevkifatKodlari(ayar: TevkifatFirmaAyari | null | undefined): string[] {
  if (!ayar) return [];
  if (Array.isArray(ayar.gizli)) return [...new Set(ayar.gizli)];
  return [...new Set((ayar.degisiklikler ?? []).filter((d) => d.pasif).map((d) => d.kod))];
}

/** Merkezi kayıtlar (belge tarihinde yürürlükteki) + firmanın gizledikleri → tablo. */
export function tevkifatTablosuKur(kayitlar: readonly TevkifatMerkezKaydi[], gizli: readonly string[] = []): TevkifatKodu[] {
  const gizliler = new Set(gizli);
  return kayitlar
    .map((k) => {
      const d = (k.deger ?? {}) as { ad?: unknown; oranlar?: unknown };
      const oranlar = Array.isArray(d.oranlar) ? d.oranlar.filter((o): o is string => typeof o === "string") : [];
      return { kod: k.anahtar, ad: typeof d.ad === "string" ? d.ad : "", oranlar, ...(gizliler.has(k.anahtar) ? { pasif: true } : {}) };
    })
    .filter((k) => k.oranlar.length > 0)
    .sort((a, b) => a.kod.localeCompare(b.kod));
}
