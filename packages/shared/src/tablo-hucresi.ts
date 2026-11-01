/**
 * SEC-09: CSV/düz metin tablo dışa aktarımlarında formül enjeksiyonu. Excel,
 * LibreOffice ve Google Sheets `=`, `+`, `-`, `@` (ve sekme/satır başı) ile
 * başlayan hücreyi tırnak içinde de olsa formül olarak çalıştırır; cari ünvanı,
 * açıklama gibi dışarıdan gelen metin `=HYPERLINK(...)` ya da DDE komutu taşıyabilir.
 * Böyle metinlerin başına tek tırnak eklenir; sayı ve tutarlar ("-12,50") dokunulmaz.
 *
 * xlsx dosyalarında metin hücreleri metin türüyle yazıldığından bu gerekmez.
 */
const FORMUL_BASI = /^[=+\-@\t\r]/;
const SAYI = /^[-+]?\d[\d.,\s]*%?$/;

export function tabloMetniGuvenli(deger: string): string {
  return FORMUL_BASI.test(deger) && !SAYI.test(deger.trim()) ? `'${deger}` : deger;
}

/** CSV hücresi: boş değer boş, metin formülden arındırılıp her zaman çift tırnakla. */
export function csvHucresi(deger: unknown): string {
  if (deger === null || deger === undefined) return '""';
  const metin = typeof deger === "string" ? tabloMetniGuvenli(deger) : String(deger);
  return `"${metin.replace(/"/g, '""')}"`;
}

/** Satırları ayırıcıyla birleştirir (Türkçe Excel için varsayılan `;`). */
export function csvSatirlari(satirlar: readonly (readonly unknown[])[], ayirici = ";"): string {
  return satirlar.map((s) => s.map(csvHucresi).join(ayirici)).join("\n");
}
