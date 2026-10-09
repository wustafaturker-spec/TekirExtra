/**
 * Firmaya özel tevkifat tablosu (FTR-35, karar 2026-10-09).
 *
 * Varsayılan tablo GİB kod listesinden gelir (`TEVKIFAT_KODLARI`). Mevzuat
 * değiştiğinde yeni sürümü beklemeden yönetici Ayarlar > Tevkifat'tan bir
 * kodun oranlarını değiştirebilir, GİB'in yeni yayımladığı bir kodu ekleyebilir
 * ya da kullanmadığı kodu pasif yapabilir. Yalnız **değişiklikler** saklanır:
 * dokunulmamış kodlar varsayılanı izler, böylece sonraki varsayılan güncellemesi
 * firmaya da ulaşır. "Varsayılana dön" değişikliği silmektir.
 *
 * Kesinleşmiş fatura satırı oranını kendisinde saklar; tablo değişikliği onu
 * etkilemez. Taslak bir sonraki kaydedişte yeni oranla hesaplanır.
 */
import { TEVKIFAT_KODLARI, type TevkifatKodu } from "./gib-kodlari";

export interface TevkifatDegisikligi {
  kod: string;
  /** Yalnız eklenen kodda zorunlu; varsayılan kodda boşsa GİB adı kalır. */
  ad?: string | null;
  /** Boşsa varsayılan oranlar kalır; eklenen kodda zorunlu. */
  oranlar?: string[] | null;
  pasif?: boolean;
}

const ORAN_DESENI = /^(\d{1,2})\/(\d{1,2})$/;
const KOD_DESENI = /^\d{3}$/;

/** "4/10" gibi bir tevkifat oranı geçerli mi (pay 1…payda). */
export function tevkifatOraniGecerliMi(oran: string): boolean {
  const e = oran.match(ORAN_DESENI);
  if (!e) return false;
  const pay = Number(e[1]), payda = Number(e[2]);
  return pay >= 1 && payda >= 1 && pay <= payda;
}

/** Ayar kaydedilmeden önce (API şeması ve ekran) aynı liste üretilir. */
export function tevkifatAyarHatalari(degisiklikler: TevkifatDegisikligi[]): string[] {
  const hatalar: string[] = [];
  const gorulen = new Set<string>();
  for (const d of degisiklikler) {
    const kod = d.kod?.trim() ?? "";
    if (!KOD_DESENI.test(kod)) { hatalar.push(`Tevkifat kodu üç haneli olmalıdır: ${kod || "(boş)"}`); continue; }
    if (gorulen.has(kod)) hatalar.push(`${kod} kodu birden çok kez girilmiş`);
    gorulen.add(kod);
    const varsayilan = TEVKIFAT_KODLARI.some((k) => k.kod === kod);
    const oranlar = d.oranlar ?? [];
    if (!varsayilan && !d.ad?.trim()) hatalar.push(`${kod} kodunun adı girilmelidir`);
    if (!varsayilan && oranlar.length === 0) hatalar.push(`${kod} kodu için en az bir oran girilmelidir`);
    for (const o of oranlar) {
      if (!tevkifatOraniGecerliMi(o)) hatalar.push(`${kod} kodunda geçersiz oran: ${o} (ör. 4/10)`);
    }
    if (new Set(oranlar).size !== oranlar.length) hatalar.push(`${kod} kodunda aynı oran birden çok kez girilmiş`);
  }
  return hatalar;
}

/** Varsayılan tablo + firmanın değişiklikleri; eklenen kodlar kod sırasıyla sona. */
export function tevkifatTablosuCoz(degisiklikler: readonly TevkifatDegisikligi[] = []): TevkifatKodu[] {
  const harita = new Map(degisiklikler.map((d) => [d.kod.trim(), d]));
  const tablo: TevkifatKodu[] = TEVKIFAT_KODLARI.map((k) => {
    const d = harita.get(k.kod);
    if (!d) return k;
    return { kod: k.kod, ad: d.ad?.trim() || k.ad, oranlar: d.oranlar?.length ? [...d.oranlar] : k.oranlar, ...(d.pasif ? { pasif: true } : {}) };
  });
  const eklenen = degisiklikler
    .filter((d) => !TEVKIFAT_KODLARI.some((k) => k.kod === d.kod.trim()))
    .map((d): TevkifatKodu => ({ kod: d.kod.trim(), ad: d.ad?.trim() ?? "", oranlar: [...(d.oranlar ?? [])], ...(d.pasif ? { pasif: true } : {}) }))
    .sort((a, b) => a.kod.localeCompare(b.kod));
  return [...tablo, ...eklenen];
}
