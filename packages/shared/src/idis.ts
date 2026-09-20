/**
 * İnşaat Demiri İzleme Sistemi (İDİS) faturaları ve irsaliyeleri
 * (GİB "İDİS Kapsamında Yapılan Teslimlere İlişkin Fatura ve İrsaliye Teknik
 * Kılavuzu" v1.0, Aralık 2025 — `docs/e-belge/IDIS-Teknik-Kilavuzu-v1.0.pdf`;
 * sevkiyat no biçimi 14.09.2026 şematronu §2 ile genişledi).
 *
 * İDİS bir **profildir**, fatura tipi değil: belge `ProfileID=IDIS` (e-İrsaliye
 * `IDISIRSALIYE`) ile gider, `InvoiceTypeCode` normal kurallarla türer
 * (SATIS, ISTISNA, TEVKIFAT, TEVKIFATIADE, IADE, IHRACKAYITLI). İki alan
 * zorunludur: Darphane'ye yapılan bildirimden dönen **sevkiyat numarası**
 * (satıcı tarafında) ve her satırdaki **etiket numarası**.
 */

export const IDIS_PROFILI = "IDIS";
export const IDIS_IRSALIYE_PROFILI = "IDISIRSALIYE";

/**
 * Sevkiyat no: kılavuz `SE-` + 7 rakam der, 14.09.2026 şematronu `ES-` önekini
 * de kabul eder (§2). Toplam 10 karakter.
 */
export const SEVKIYAT_NO_DESENI = /^(SE|ES)-\d{7}$/;

/** Etiket no: ilk 2 harf, sonraki 7 rakam — toplam 9 karakter. */
export const ETIKET_NO_DESENI = /^[A-Z]{2}\d{7}$/;

export const idisNormalize = (deger: string | null | undefined): string =>
  (deger ?? "").replace(/\s/g, "").toLocaleUpperCase("en-US");

export function sevkiyatNoGecerliMi(deger: string | null | undefined): boolean {
  return SEVKIYAT_NO_DESENI.test(idisNormalize(deger));
}

export function etiketNoGecerliMi(deger: string | null | undefined): boolean {
  return ETIKET_NO_DESENI.test(idisNormalize(deger));
}

export interface IdisBilgisi {
  sevkiyatNo?: string | null;
  satirlar?: { sira: number; etiketNo?: string | null }[];
}

export type IdisAlan = "sevkiyatNo" | "etiketNo";

export interface IdisEngeli {
  alan: IdisAlan;
  mesaj: string;
}

/**
 * Belge İDİS kapsamında mı: sevkiyat numarası girilmişse öyledir. Ayrı bir
 * işaret aranmaz — sevkiyat numarası zaten yalnız bu kapsamda üretilir.
 */
export function idisBelgesiMi(sevkiyatNo: string | null | undefined): boolean {
  return Boolean(idisNormalize(sevkiyatNo));
}

/** İDİS belgesinin gönderimini engelleyen eksikler. */
export function idisEngelleri(bilgi: IdisBilgisi): IdisEngeli[] {
  if (!idisBelgesiMi(bilgi.sevkiyatNo)) return [];
  const engeller: IdisEngeli[] = [];

  if (!sevkiyatNoGecerliMi(bilgi.sevkiyatNo)) {
    engeller.push({ alan: "sevkiyatNo", mesaj: "Sevkiyat numarası SE-0000000 ya da ES-0000000 biçiminde olmalıdır" });
  }
  for (const satir of bilgi.satirlar ?? []) {
    if (!satir.etiketNo?.trim()) {
      engeller.push({ alan: "etiketNo", mesaj: `${satir.sira}. satırda İDİS etiket numarası girilmelidir` });
    } else if (!etiketNoGecerliMi(satir.etiketNo)) {
      engeller.push({ alan: "etiketNo", mesaj: `${satir.sira}. satırdaki etiket numarası 2 harf + 7 rakam olmalıdır (örn. CV0152457)` });
    }
  }
  return engeller;
}
