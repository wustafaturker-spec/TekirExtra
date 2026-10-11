import { VARSAYILAN_VERGI_TURLERI, type VergiTuru } from "@tekirextra/shared";

/**
 * EBLG-133: firma tasarımı (XSLT) entegratörde çalışır, Mevzuat Merkezi'ne
 * soramaz. Stopaj (eksi basılır) ve KDV matrahına dahil (KDV matrahından önce
 * basılır) vergi kodları tasarım üretilirken o günkü merkezi listeden
 * şablona yazılır. Liste sonradan değişirse yüklenmiş tasarım eskir; imza
 * hangi listeyle üretildiğini söyler.
 */
export function tasarimVergiKodlari(turler: readonly VergiTuru[]): { stopaj: string[]; dahil: string[] } {
  const sirali = [...turler].sort((a, b) => a.kod.localeCompare(b.kod));
  return {
    stopaj: sirali.filter((t) => t.stopaj).map((t) => t.kod),
    dahil: sirali.filter((t) => t.kdvMatrahinaDahil && !t.stopaj).map((t) => t.kod),
  };
}

export function vergiKodImzasi(turler: readonly VergiTuru[]): string {
  const { stopaj, dahil } = tasarimVergiKodlari(turler);
  return `stopaj=${stopaj.join(",")};dahil=${dahil.join(",")}`;
}

/** Bu özellikten önce yüklenen tasarımlar sabit listeyle (ilk dolum) üretilmişti. */
export const ESKI_TASARIM_IMZASI = vergiKodImzasi(VARSAYILAN_VERGI_TURLERI);

/** Vergi taşıyan tasarım türleri; e-İrsaliyede vergi yoktur. */
export const VERGILI_TASARIM_TURLERI = ["efatura", "earsiv"] as const;

/** Firmanın kendi tasarımının entegratördeki adı `TX<VKN>-<TÜR>-v<sürüm>`. */
export const firmaTasarimOneki = (vkn: string) => `TX${vkn}-`;

/**
 * Seçili tasarım firma tasarımıysa ve güncel listeden farklı bir listeyle
 * üretildiyse true. İmzası bilinmeyen firma tasarımı eski sabit listeyle
 * üretilmiş sayılır; başka (elle yüklenmiş) tasarım denetlenmez.
 */
export function tasarimVergiKodlariEski(secili: string | null | undefined, vkn: string, imzalar: Record<string, string> | undefined, guncelImza: string): boolean {
  if (!secili || !secili.startsWith(firmaTasarimOneki(vkn))) return false;
  return (imzalar?.[secili] ?? ESKI_TASARIM_IMZASI) !== guncelImza;
}
