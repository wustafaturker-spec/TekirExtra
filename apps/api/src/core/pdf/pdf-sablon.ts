/**
 * Ortak PDF şablon yardımcıları (T-02): TR sayı/tarih biçimleri, HTML kaçışı
 * ve tüm PDF çıktılarının paylaştığı sayfa iskeleti. Sayfanın rengi ve
 * yerleşimi kiracının seçtiği temadan gelir (FTR-22/23, `belge-temasi.ts`);
 * tema verilmezse varsayılan şablon ve renk kullanılır.
 */
import { type BelgeTemasi, VARSAYILAN_TEMA, sayfaStili } from "./belge-temasi";

const PARA = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SAYI = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });

export const paraBicim = (deger: string | number): string =>
  PARA.format(Number(deger));

export const sayiBicim = (deger: string | number): string =>
  SAYI.format(Number(deger));

const KUR = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });

/** Döviz kuru; `sayiBicim` üç haneye yuvarladığı için ayrı tutulur. */
export const kurBicim = (deger: string | number): string =>
  KUR.format(Number(deger));

/**
 * Dövizli belgedeki bir tutarın TL karşılığı, kuruşa yuvarlanmış (EBLG-57).
 * Toplamlar ayrı ayrı çevrilir; e-belge görünümlerinin yaptığı da budur.
 */
export const tlKarsiligi = (deger: string | number, kur: string | number): number =>
  Math.round(Number(deger) * Number(kur) * 100) / 100;

export const tarihBicim =(deger: Date | string): string =>
  new Date(deger).toLocaleDateString("tr-TR");

export const kacis = (deger: unknown): string =>
  String(deger ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Firma kutusunun VKN altındaki satırları (EBLG-62): adres, iletişim, MERSİS
 * ve ticaret sicil. Boş alan satır üretmez; kart eksikse kutu eskisi gibi kalır.
 */
export interface FirmaIletisimi {
  adres?: string | null; ilce?: string | null; il?: string | null; postaKodu?: string | null;
  telefon?: string | null; eposta?: string | null; webSitesi?: string | null;
  mersisNo?: string | null; ticaretSicilNo?: string | null;
}

export function firmaIletisimSatirlari(firma: FirmaIletisimi): string {
  const yer = [firma.postaKodu, [firma.ilce, firma.il].filter(Boolean).join(" / ")].filter(Boolean).join(" ");
  const satirlar = [
    firma.adres,
    yer,
    [firma.telefon && `Tel: ${firma.telefon}`, firma.eposta].filter(Boolean).join(" · "),
    firma.webSitesi,
    [firma.mersisNo && `MERSİS: ${firma.mersisNo}`, firma.ticaretSicilNo && `Tic. Sicil: ${firma.ticaretSicilNo}`].filter(Boolean).join(" · "),
  ].filter((s): s is string => Boolean(s));
  return satirlar.map((s) => `<br>${kacis(s)}`).join("");
}

export interface SayfaSecenekleri {
  /** Belge başlığı (ör. "SATIŞ FATURASI", rapor adı). */
  baslik: string;
  /** Başlığın altındaki küçük satır (ör. firma ünvanı, filtre özeti). */
  altBaslik?: string;
  /** Gövde HTML'i. */
  icerik: string;
  /** FTR-22/23: şablon, vurgu rengi ve firma logosu (KLN-03). */
  tema?: BelgeTemasi;
}

/** Tüm PDF'lerin ortak iskeleti: üst şerit, içerik, tarihli alt bilgi. */
export function sayfaSablonu(s: SayfaSecenekleri): string {
  const tema = s.tema ?? VARSAYILAN_TEMA;
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>${sayfaStili(tema)}</style>
</head>
<body class="sablon-${kacis(tema.sablon)}">
  <div class="ust-serit">
    <h1>${kacis(s.baslik)}</h1>
    ${
      tema.logoDataUri
        ? `<img class="logo" src="${kacis(tema.logoDataUri)}" alt="">`
        : `<span class="marka">TekirExtra</span>`
    }
  </div>
  ${s.altBaslik ? `<div class="alt-baslik">${kacis(s.altBaslik)}</div>` : ""}
  ${s.icerik}
  <div class="alt-bilgi">
    <span>TekirExtra ile oluşturuldu</span>
    <span>${tarihBicim(new Date())}</span>
  </div>
</body>
</html>`;
}
