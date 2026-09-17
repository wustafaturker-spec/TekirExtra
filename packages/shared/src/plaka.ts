/**
 * Plaka kuralları (GİB şematron, 14.09.2026 revizyonu —
 * `docs/e-belge/SEMATRONDEGISIKLIKLERI_484.pdf` §3).
 *
 * İrsaliyede şoför bilgisi varsa araç plakası zorunludur ve plaka UBL'e
 * **türüne göre farklı `schemeID` ile** yazılır: Türkiye plakası `PLAKA`,
 * yabancı plaka `YABANCIPLAKA`; dorsede `DORSEPLAKA` ve `YABANCIDORSEPLAKA`.
 * Format tutmazsa belge GİB tarafından reddedilir, bu yüzden kural hem şemada
 * hem ekranda aynı yerden okunur.
 */

export type PlakaTuru = "tr" | "yabanci";

/** Türkiye plakası: 01-81 il kodu + 1-3 büyük harf + 1-5 rakam (boşluksuz). */
const TR_KALIBI = /^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}[0-9]{1,5}$/;

/** Yabancı plaka: yalnızca büyük harf, rakam, alt çizgi ve tire. */
const YABANCI_KALIBI = /^[A-Z0-9_-]+$/;

/**
 * Kullanıcının yazdığını GİB'in beklediği biçime getirir: boşluklar atılır,
 * harfler büyütülür. "34 abc 123" → "34ABC123". Türkçe küçük harf tuzağı için
 * `tr-TR` büyütmesi kullanılır (i → İ).
 */
export function plakaNormalize(deger: string | null | undefined): string {
  return (deger ?? "").replace(/\s+/g, "").toLocaleUpperCase("tr-TR");
}

/** Normalize edilmiş plakanın türü; hiçbir kalıba uymuyorsa `null`. */
export function plakaTuru(deger: string | null | undefined): PlakaTuru | null {
  const plaka = plakaNormalize(deger);
  if (!plaka) return null;
  if (TR_KALIBI.test(plaka)) return "tr";
  // Yabancı plaka kümesi TR kalıbını da kapsar; sıra bu yüzden önemlidir.
  return YABANCI_KALIBI.test(plaka) ? "yabanci" : null;
}

export function plakaGecerliMi(deger: string | null | undefined): boolean {
  return plakaTuru(deger) !== null;
}

/** Araç plakasının UBL `schemeID`'si (şematron §3-1). */
export function plakaSchemeId(deger: string | null | undefined): "PLAKA" | "YABANCIPLAKA" {
  return plakaTuru(deger) === "yabanci" ? "YABANCIPLAKA" : "PLAKA";
}

/** Dorse plakasının UBL `schemeID`'si (şematron §3-2). */
export function dorseSchemeId(deger: string | null | undefined): "DORSEPLAKA" | "YABANCIDORSEPLAKA" {
  return plakaTuru(deger) === "yabanci" ? "YABANCIDORSEPLAKA" : "DORSEPLAKA";
}

export const PLAKA_HATA_MESAJI =
  "Plaka ya Türkiye biçiminde (01-81 il kodu + harf + rakam, ör. 34ABC123) ya da yalnızca büyük harf, rakam, tire ve alt çizgiden oluşan yabancı plaka olmalıdır";
