/**
 * EBLG-77: firmanın **kendi** e-belge mükellefiyetleri. Uygulama bugüne kadar
 * her kiracıyı e-Fatura mükellefi saydı; oysa yalnız e-Arşiv kullanan ya da
 * hiçbir e-belge uygulamasına kayıtlı olmayan (kağıt fatura kesen) firmalar da
 * var. Kapalı uygulamanın ekranları gizlenir, uçları reddeder.
 */
export const EBELGE_UYGULAMALARI = [
  { kod: "efatura", ad: "e-Fatura" },
  { kod: "earsiv", ad: "e-Arşiv" },
  { kod: "eirsaliye", ad: "e-İrsaliye" },
] as const;

export type EbelgeUygulamaKodu = (typeof EBELGE_UYGULAMALARI)[number]["kod"];

export const EBELGE_UYGULAMA_KODLARI = EBELGE_UYGULAMALARI.map((u) => u.kod) as [EbelgeUygulamaKodu, ...EbelgeUygulamaKodu[]];

/** Tek bir uygulamanın durumu; `null` "bilinmiyor" demektir (EBLG-76 kalıbı). */
export interface UygulamaDurumu {
  acik: boolean | null;
  kaynak: "elle" | "entegrator" | "bilinmiyor";
}

export type EbelgeUygulamalari = Record<EbelgeUygulamaKodu, UygulamaDurumu>;

/**
 * Firma ayarındaki elle seçim ile GİB mükellef listesinden okunanı birleştirir.
 *
 * - Elle `true`/`false` verilmişse o geçerlidir; boşsa listeye bakılır.
 * - **e-Arşiv listesi GİB'de yayınlanmaz**: otomatikte e-Fatura mükellefiyetini
 *   izler, çünkü e-Fatura mükellefi zorunlu e-Arşiv mükellefidir. Yalnız
 *   e-Arşiv kullanan firma bunu firma ayarından elle söyler.
 * - **e-İrsaliye e-Fatura'ya bağlıdır**: e-Fatura kapalıyken e-İrsaliye de
 *   kapalıdır, elle "evet" denmiş olsa bile.
 */
export function ebelgeUygulamalariCoz(girdi: {
  elle: { efatura: boolean | null; earsiv: boolean | null; eirsaliye: boolean | null };
  liste: { efatura: boolean; eirsaliye: boolean; guncel: boolean };
}): EbelgeUygulamalari {
  const listeden = (listede: boolean): UygulamaDurumu =>
    girdi.liste.guncel ? { acik: listede, kaynak: "entegrator" } : { acik: null, kaynak: "bilinmiyor" };
  const elleyle = (deger: boolean | null, otomatik: UygulamaDurumu): UygulamaDurumu =>
    deger === null || deger === undefined ? otomatik : { acik: deger, kaynak: "elle" };

  const efatura = elleyle(girdi.elle.efatura, listeden(girdi.liste.efatura));
  const earsiv = elleyle(girdi.elle.earsiv, efatura.acik ? { acik: true, kaynak: efatura.kaynak } : { acik: null, kaynak: "bilinmiyor" });
  const eirsaliye = efatura.acik === false
    ? { acik: false as const, kaynak: efatura.kaynak }
    : elleyle(girdi.elle.eirsaliye, listeden(girdi.liste.eirsaliye));

  return { efatura, earsiv, eirsaliye };
}

/**
 * Firma ayarında "kayıtlı değiliz" denmiş ama firmanın kendi VKN'si GİB
 * listesinde görünüyor. Entegratör ve GİB listeye bakar, ayarımıza değil:
 * e-Fatura'da bu ayarla mükellef alıcıya kesilen e-Arşiv belgesi
 * "ALICI EFATURA MUKELLEFIDIR" diye reddedilir (NES testi 2026-09-22).
 * Liste eski olsa da uyarılır — kayıt tek başına güçlü bir işarettir.
 */
export function mukellefiyetCelismeleri(girdi: {
  elle: { efatura: boolean | null; eirsaliye: boolean | null };
  liste: { efatura: boolean; eirsaliye: boolean };
}): string[] {
  const celismeler: string[] = [];
  if (girdi.elle.efatura === false && girdi.liste.efatura) {
    celismeler.push("Firmanız GİB listesinde e-Fatura mükellefi görünüyor. Bu ayarla e-Fatura mükellefi alıcılara kesilen faturalar e-Arşiv olarak gider ve GİB tarafından reddedilir.");
  }
  if (girdi.elle.eirsaliye === false && girdi.elle.efatura !== false && girdi.liste.eirsaliye) {
    celismeler.push("Firmanız GİB listesinde e-İrsaliye mükellefi görünüyor. Bu ayarla sevkiyatlar için e-İrsaliye düzenlenmez ve faturada sevkiyat sorulmaz.");
  }
  return celismeler;
}

/** Uygulama kesin olarak açık mı? "Bilinmiyor" açık sayılmaz. */
export function uygulamaAcik(uygulamalar: EbelgeUygulamalari, kod: EbelgeUygulamaKodu): boolean {
  return uygulamalar?.[kod]?.acik === true;
}

/**
 * Firma hiçbir e-belge uygulamasına kayıtlı değil: fatura kağıda basılır.
 * Eksik ayar "kayıtlı değil" sayılmaz; yalnız iki uygulama da kesin kapalıysa.
 */
export function ebelgeKullanilmiyor(uygulamalar: EbelgeUygulamalari): boolean {
  return uygulamalar?.efatura?.acik === false && uygulamalar?.earsiv?.acik === false;
}

/**
 * Belgenin hangi kanaldan gideceği. **Satıcının kapsamı alıcınınkinden
 * önce gelir:** e-Fatura mükellefi olmayan firma, alıcı mükellef olsa bile
 * e-Fatura kesemez — belge e-Arşiv'e düşer. İki uygulama da kapalıysa belge
 * e-belge olarak hiç gönderilmez (`null`).
 */
export function ebelgeKanali(girdi: {
  uygulamalar: EbelgeUygulamalari;
  aliciEfaturaMukellefi: boolean;
}): "efatura" | "earsiv" | null {
  if (girdi.aliciEfaturaMukellefi && uygulamaAcik(girdi.uygulamalar, "efatura")) return "efatura";
  if (uygulamaAcik(girdi.uygulamalar, "earsiv")) return "earsiv";
  return null;
}

/**
 * Gönderimi durduran eksikler. Durumu "bilinmiyor" olan firmada belge
 * göndermeyiz: liste güncel değilken sessizce e-Arşiv'e düşmek, e-Fatura
 * mükellefi alıcıya yanlış belge kesmek olurdu.
 */
export function ebelgeKanalEngelleri(girdi: {
  uygulamalar: EbelgeUygulamalari;
  aliciEfaturaMukellefi: boolean;
}): string[] {
  const { uygulamalar } = girdi;
  if (ebelgeKullanilmiyor(uygulamalar)) {
    return ["Firma e-Fatura ve e-Arşiv uygulamalarına kayıtlı değil; bu fatura kağıt olarak düzenlenir."];
  }
  /*
   * Bilinmezlik satıcının kapsamındadır, alıcıya bakılarak çözülemez: e-Fatura
   * durumu belirsizken belge e-Arşiv'e düşürülürse, firma aslında mükellefse
   * mükellef alıcıya yanlış belge kesilmiş olur. Bu yüzden alıcının durumuna
   * hiç bakmadan durdururuz.
   */
  if (uygulamalar.efatura.acik === null) {
    return ["Firmanın e-Fatura mükellefiyeti bilinmiyor; GİB mükellef listesini güncelleyin veya firma ayarından belirtin."];
  }
  if (ebelgeKanali(girdi) === null) {
    return ["Firmanın e-Arşiv mükellefiyeti bilinmiyor; firma ayarından belirtin."];
  }
  return [];
}
